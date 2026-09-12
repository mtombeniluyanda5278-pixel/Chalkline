import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {z} from 'zod';
import {requireUser,requireRecentAuth} from './auth.js';
import {pool} from './db.js';
import {transaction} from './transactions.js';
import {failure,parse,limit,itemId} from './http.js';
import {maskedEmail} from './recovery.js';
import {config} from './config.js';
import {deliverDevOrLogEmail} from './mail.js';
export async function requireAdmin(req:FastifyRequest,reply:FastifyReply){
 const user=await requireUser(req,reply);if(!user)return null;
 if(user.role!=='admin')throw failure(403,'Administrator access required.');
 if(!await requireRecentAuth(user,reply,5*60*1000))return null;
 if(config.ADMIN_REQUIRE_PASSKEY && user.authMethod!=='passkey')throw failure(403,'Use a passkey for administrator access.');
 await limit('admin',user.id);return user;
}
const Category=z.enum(['bug','feature','usability','content','other']);
const Diagnostics=z.strictObject({appVersion:z.string().max(40),route:z.enum(['dashboard','notes','lessons','templates','files','account','onboarding','feedback','other']),browser:z.enum(['Chrome','Firefox','Safari','Edge','Other']),os:z.enum(['Windows','macOS','Linux','iOS','Android','Other']),viewport:z.strictObject({width:z.number().int().min(1).max(20000),height:z.number().int().min(1).max(20000)}),timestamp:z.iso.datetime(),requestId:z.uuid().optional()});
export async function registerAdminRoutes(app:FastifyInstance){
 app.post('/v1/feedback',async(req,reply)=>{
  const user=await requireUser(req,reply);if(!user)return;await limit('feedback',user.id);
  const b=parse(z.strictObject({category:Category,message:z.string().trim().min(10).max(4000),includeDiagnostics:z.boolean().default(false),diagnostics:Diagnostics.optional()}),req.body);
  return transaction(async c=>{
   const row=(await c.query('INSERT INTO feedback(user_id,category,message,diagnostics) VALUES($1,$2,$3,$4) RETURNING id,status',[user.id,b.category,b.message,b.includeDiagnostics?b.diagnostics??null:null])).rows[0];
   if(config.ADMIN_NOTIFICATION_EMAIL)await deliverDevOrLogEmail({to:config.ADMIN_NOTIFICATION_EMAIL,subject:'New Chix feedback',body:`Category: ${b.category}. Review securely: ${config.WEBAUTHN_ORIGIN}/#/admin`},c,`feedback:${row.id}`);
   return reply.code(201).send({item:row});
  });
 });
 app.get('/v1/feedback',async(req,reply)=>{const user=await requireUser(req,reply);if(!user)return;return {items:(await pool.query('SELECT id,category,message,status,created_at FROM feedback WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',[user.id])).rows};});
 app.get('/v1/feedback/:id',async(req,reply)=>{const user=await requireUser(req,reply);if(!user)return;const row=(await pool.query('SELECT id,category,message,status,created_at FROM feedback WHERE id=$1 AND user_id=$2',[itemId(req),user.id])).rows[0];if(!row)throw failure(404,'Feedback unavailable.');return {item:row};});
 app.get('/v1/admin/users',async(req,reply)=>{
  if(!await requireAdmin(req,reply))return;
  const q=parse(z.object({offset:z.coerce.number().int().min(0).default(0)}),req.query);
  const rows=(await pool.query('SELECT id,first_name,left(last_name,1) AS last_initial,email,email_verified_at IS NOT NULL AS primary_verified,recovery_verified_at IS NOT NULL AS recovery_verified,onboarding_completed_at IS NOT NULL AS onboarded,suspended_at IS NOT NULL AS suspended,created_at,EXISTS(SELECT 1 FROM webauthn_credentials w WHERE w.user_id=u.id) AS has_passkey,EXISTS(SELECT 1 FROM trusted_devices d WHERE d.user_id=u.id AND revoked_at IS NULL AND expires_at>now()) AS has_device FROM users u ORDER BY created_at DESC,id LIMIT 20 OFFSET $1',[q.offset])).rows;
  return {items:rows.map(({email,...row})=>({...row,email:maskedEmail(email)}))};
 });
 app.post('/v1/admin/users/:id/contact',async(req,reply)=>{
  const admin=await requireAdmin(req,reply);if(!admin)return;
  const b=parse(z.strictObject({reason:z.string().trim().min(10).max(300)}),req.body);
  return transaction(async c=>{
   const row=(await c.query('SELECT email,recovery_email FROM users WHERE id=$1',[itemId(req)])).rows[0];if(!row)throw failure(404,'Account unavailable.');
   await c.query("INSERT INTO admin_audit_log(admin_user_id,target_user_id,action,metadata) VALUES($1,$2,'contact_reveal',$3)",[admin.id,itemId(req),{reason:b.reason}]);return row;
  });
 });
 app.post('/v1/admin/users/:id/suspension',async(req,reply)=>{
  const admin=await requireAdmin(req,reply);if(!admin)return;const b=parse(z.strictObject({suspended:z.boolean(),reason:z.string().trim().min(10).max(300)}),req.body);
  if(itemId(req)===admin.id)throw failure(400,'Cannot suspend your own account.');
  await transaction(async c=>{
   if(!(await c.query('UPDATE users SET suspended_at=CASE WHEN $2 THEN now() ELSE NULL END,auth_epoch=auth_epoch+1 WHERE id=$1',[itemId(req),b.suspended])).rowCount)throw failure(404,'Account unavailable.');
   await c.query('DELETE FROM sessions WHERE user_id=$1',[itemId(req)]);
   await c.query("INSERT INTO admin_audit_log(admin_user_id,target_user_id,action,metadata) VALUES($1,$2,'suspension',$3)",[admin.id,itemId(req),b]);
  });return {ok:true};
 });
 app.get('/v1/admin/feedback',async(req,reply)=>{if(!await requireAdmin(req,reply))return;return {items:(await pool.query('SELECT id,category,message,status,created_at,diagnostics FROM feedback ORDER BY created_at DESC LIMIT 50')).rows};});
 app.patch('/v1/admin/feedback/:id',async(req,reply)=>{
  const admin=await requireAdmin(req,reply);if(!admin)return;const b=parse(z.strictObject({status:z.enum(['NEW','REVIEWING','PLANNED','RESOLVED','CLOSED'])}),req.body);
  await transaction(async c=>{
   if(!(await c.query('UPDATE feedback SET status=$2,updated_at=now() WHERE id=$1',[itemId(req),b.status])).rowCount)throw failure(404,'Feedback unavailable.');
   await c.query("INSERT INTO admin_audit_log(admin_user_id,action,metadata) VALUES($1,'feedback_status',$2)",[admin.id,{feedbackId:itemId(req),status:b.status}]);
  });return {ok:true};
 });
 app.get('/v1/admin/jobs',async(req,reply)=>{if(!await requireAdmin(req,reply))return;return {scans:(await pool.query("SELECT id,attempts,state,available_at,lease_until FROM jobs WHERE state<>'done' ORDER BY available_at LIMIT 50")).rows,mail:(await pool.query("SELECT state,count(*) FROM notification_outbox GROUP BY state")).rows,deletions:(await pool.query('SELECT state,count(*) FROM object_deletions GROUP BY state')).rows};});
 app.post('/v1/admin/jobs/:id/retry',async(req,reply)=>{
  const admin=await requireAdmin(req,reply);if(!admin)return;
  await transaction(async c=>{
   const row=(await c.query("UPDATE jobs SET state='pending',attempts=0,available_at=now(),lease_until=NULL WHERE id=$1 AND state='dead' RETURNING resource_id",[itemId(req)])).rows[0];if(!row)throw failure(404,'Job unavailable.');
   if(!(await c.query("UPDATE resources SET status='pending_scan' WHERE id=$1 AND status='scan_failed'",[row.resource_id])).rowCount)throw failure(409,'Only failed scans can be retried.');
   await c.query("INSERT INTO admin_audit_log(admin_user_id,action,metadata) VALUES($1,'scan_retry',$2)",[admin.id,{jobId:itemId(req)}]);
  });return {ok:true};
 });
}
