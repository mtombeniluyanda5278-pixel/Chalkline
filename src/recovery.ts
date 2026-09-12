import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser, requireRecentAuth } from './auth.js';
import { transaction } from './transactions.js';
import { pool } from './db.js';
import { parse, limit, failure } from './http.js';
import { issueEmailToken, consumeEmailToken } from './tokens.js';
import { securityEvent } from './security.js';
import { deliverDevOrLogEmail } from './mail.js';
export const maskedEmail=(email:string|null)=>email ? `${email.slice(0,1)}***@${email.split('@')[1]?.slice(0,1)}***.${email.split('.').at(-1)}`:null;
const Email=z.string().trim().email().max(254).toLowerCase();
const Token=z.strictObject({token:z.string().min(20).max(200)});
export async function registerRecoveryRoutes(app:FastifyInstance) {
 app.get('/v1/me/recovery-email',async(req,reply)=>{
  const user=await requireUser(req,reply);if(!user)return;
  const row=(await pool.query('SELECT recovery_email,pending_recovery_email FROM users WHERE id=$1',[user.id])).rows[0];
  return {email:maskedEmail(row.recovery_email),pendingEmail:maskedEmail(row.pending_recovery_email)};
 });
 app.post('/v1/me/recovery-email',async(req,reply)=>{
  const session=await requireUser(req,reply);if(!session || !await requireRecentAuth(session,reply))return;
  await limit('emailChange',session.id);const b=parse(z.strictObject({email:Email}),req.body);
  await transaction(async c=>{
   const user=(await c.query('SELECT email FROM users WHERE id=$1 FOR UPDATE',[session.id])).rows[0];
   if(user.email.toLowerCase()===b.email)throw failure(400,'Choose an address different from your primary email.');
   await c.query('UPDATE users SET pending_recovery_email=$2 WHERE id=$1',[session.id,b.email]);
   await issueEmailToken(c,session.id,'verify_recovery',b.email);
   await securityEvent(session.id,'recovery_email_change_requested',req.ip,c);
  });return {ok:true};
 });
 app.post('/v1/auth/verify-recovery',async(req)=>{
  await limit('recoveryIp',req.ip);const b=parse(Token,req.body);
  await transaction(async c=>{
   const {token,user}=await consumeEmailToken(c,b.token,'verify_recovery');
   if(user.pending_recovery_email!==token.target_email || user.email===token.target_email)throw failure(400,'Invalid or expired link.');
   if(user.recovery_email)await deliverDevOrLogEmail({userId:user.id,to:user.recovery_email,subject:'Chix recovery email changed',body:'Your recovery email was changed. Review account security if you did not request this.'},c);
   await c.query('UPDATE users SET recovery_email=$2,recovery_verified_at=now(),pending_recovery_email=NULL WHERE id=$1',[user.id,token.target_email]);
   await securityEvent(user.id,'recovery_email_changed',req.ip,c);
  });return {ok:true};
 });
 app.delete('/v1/me/recovery-email',async(req,reply)=>{
  const session=await requireUser(req,reply);if(!session || !await requireRecentAuth(session,reply))return;
  await transaction(async c=>{
   const row=(await c.query('SELECT recovery_email FROM users WHERE id=$1 FOR UPDATE',[session.id])).rows[0];
   if(row.recovery_email)await deliverDevOrLogEmail({userId:session.id,to:row.recovery_email,subject:'Chix recovery email removed',body:'This recovery email was removed from your account.'},c);
   await c.query('UPDATE users SET recovery_email=NULL,recovery_verified_at=NULL,pending_recovery_email=NULL WHERE id=$1',[session.id]);
   await c.query("UPDATE email_tokens SET used_at=now() WHERE user_id=$1 AND (purpose IN ('verify_recovery','account_discovery') OR channel='recovery') AND used_at IS NULL",[session.id]);
   await securityEvent(session.id,'recovery_email_removed',req.ip,c);
  });return {ok:true};
 });
 app.post('/v1/auth/change-email',async(req)=>{
  await limit('recoveryIp',req.ip);const b=parse(Token,req.body);
  await transaction(async c=>{
   const {token,user}=await consumeEmailToken(c,b.token,'change_email');
   if(user.recovery_email===token.target_email)throw failure(400,'Primary and recovery addresses must differ.');
   if((await c.query('SELECT 1 FROM users WHERE email=$1',[token.target_email])).rowCount)throw failure(400,'Email change unavailable.');
   await deliverDevOrLogEmail({userId:user.id,to:user.email,subject:'Chix primary email changed',body:'Your primary email was changed. Review account security if you did not request this.'},c);
   await c.query('UPDATE users SET email=$2,email_verified_at=now(),auth_epoch=auth_epoch+1 WHERE id=$1',[user.id,token.target_email]);
   await c.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);
   await c.query("UPDATE email_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",[user.id]);
   await c.query("UPDATE device_challenges SET status='denied' WHERE user_id=$1 AND status IN ('pending','approved')",[user.id]);
   await securityEvent(user.id,'email_changed',req.ip,c);
  });return {ok:true};
 });
 app.post('/v1/auth/account-discovery/request',async(req)=>{
  const b=parse(z.strictObject({recoveryEmail:Email,username:z.string().trim().max(20).toLowerCase().optional(),captchaToken:z.string().max(4096).optional()}),req.body);
  await limit('recoveryIp',req.ip);await limit('passwordReset',`discovery:${b.recoveryEmail}`);
  await transaction(async c=>{
   const users=(await c.query('SELECT id FROM users WHERE recovery_email=$1 AND recovery_verified_at IS NOT NULL AND suspended_at IS NULL AND ($2::text IS NULL OR username=$2) ORDER BY id LIMIT 5 FOR UPDATE',[b.recoveryEmail,b.username??null])).rows;
   for(const user of users)await issueEmailToken(c,user.id,'account_discovery',b.recoveryEmail,'recovery');
  });return {ok:true,message:'If an account matches, a recovery link will be sent.'};
 });
 app.post('/v1/auth/account-discovery/confirm',async(req)=>{
  await limit('recoveryIp',req.ip);const b=parse(Token,req.body);
  return transaction(async c=>{
   const {token,user}=await consumeEmailToken(c,b.token,'account_discovery');
   if(user.recovery_email!==token.target_email || !user.recovery_verified_at)throw failure(400,'Invalid or expired link.');
   return {email:maskedEmail(user.email)};
  });
 });
}
