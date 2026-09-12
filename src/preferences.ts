import type {FastifyInstance} from 'fastify';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pool} from './db.js';
import {requireUser} from './auth.js';
import {parse,limit,failure} from './http.js';
import {usage} from './quota.js';
import {config} from './config.js';
import {queuePurge} from './worker.js';
export const timezone=z.string().max(100).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}});
const list=z.array(z.string().trim().min(1).max(100)).max(30);
const profile=z.strictObject({educatorType:z.enum(['school','tutor','homeschool','lecturer_future','other']),curriculum:z.enum(['CAPS','IEB','Cambridge','custom']),customCurriculum:z.string().trim().max(100).optional(),phases:z.array(z.enum(['Foundation','Intermediate','Senior','FET','Other'])).max(5),grades:list,subjects:list});
export function dateInZone(zone:string,now=new Date()){return now.toLocaleDateString('en-CA',{timeZone:zone});}
export function isBirthday(dob:string,zone:string,now=new Date()){return dateInZone(zone,now).slice(5)===dob.slice(5);}
export async function registerPreferenceRoutes(app:FastifyInstance){
 app.get('/v1/config',async()=>({appName:config.APP_NAME,bot:{provider:config.BOT_PROTECTION_PROVIDER,siteKey:config.BOT_PROTECTION_SITE_KEY,registrationRequired:config.BOT_REQUIRE_REGISTRATION}}));
 app.get('/v1/me/preferences',async(req,reply)=>{
  const user=await requireUser(req,reply);if(!user)return;
  const row=(await pool.query('SELECT session_days,timezone,personal_touches,educator_profile,onboarding_completed_at,date_of_birth,role FROM users WHERE id=$1',[user.id])).rows[0];
  const flags=(await pool.query('SELECT f.name,f.enabled,f.percentage,o.enabled AS override FROM feature_flags f LEFT JOIN feature_flag_overrides o ON o.flag=f.name AND o.user_id=$1',[user.id])).rows;
  const features=Object.fromEntries(flags.map(f=>[f.name,f.override??(f.enabled || createHash('sha256').update(user.id+f.name).digest().readUInt32BE(0)%100<f.percentage)]));
  return {sessionDays:row.session_days,timezone:row.timezone,personalTouches:row.personal_touches,profile:row.educator_profile,onboarded:Boolean(row.onboarding_completed_at),role:row.role,features,today:dateInZone(row.timezone),birthday:features.birthday&&row.personal_touches&&isBirthday(row.date_of_birth,row.timezone),usage:await usage(user.id)};
 });
 app.patch('/v1/me/preferences',async(req,reply)=>{
  const user=await requireUser(req,reply);if(!user)return;await limit('accountChange',user.id);
  const b=parse(z.strictObject({sessionDays:z.union([z.literal(1),z.literal(7),z.literal(30),z.literal(90)]).optional(),timezone:timezone.optional(),personalTouches:z.boolean().optional(),profile:profile.optional()}),req.body);
  await pool.query('UPDATE users SET session_days=coalesce($2,session_days),timezone=coalesce($3,timezone),personal_touches=coalesce($4,personal_touches),educator_profile=coalesce($5,educator_profile),onboarding_completed_at=CASE WHEN $5::jsonb IS NOT NULL THEN now() ELSE onboarding_completed_at END WHERE id=$1',[user.id,b.sessionDays??null,b.timezone??null,b.personalTouches??null,b.profile??null]);
  return {ok:true};
 });
 app.get('/v1/trash',async(req,reply)=>{
  const user=await requireUser(req,reply);if(!user)return;
  return {items:(await pool.query("SELECT id,title,kind,trashed_at FROM documents WHERE user_id=$1 AND trashed_at IS NOT NULL UNION ALL SELECT id,title,'file',trashed_at FROM resources WHERE user_id=$1 AND status='trashed' ORDER BY trashed_at DESC LIMIT 50",[user.id])).rows};
 });
 for(const kind of ['documents','resources'] as const){
  app.post(`/v1/trash/${kind}/:id/restore`,async(req,reply)=>{
   const user=await requireUser(req,reply);if(!user)return;const {id}=parse(z.object({id:z.uuid()}),req.params);
   const sql=kind==='documents'?"UPDATE documents SET trashed_at=NULL WHERE id=$1 AND user_id=$2 AND trashed_at IS NOT NULL AND trashed_at>now()-($3::int*interval '1 day')":"UPDATE resources SET status=CASE WHEN previous_status='ready' AND scanned_at IS NOT NULL THEN 'ready' ELSE 'scan_failed' END,trashed_at=NULL WHERE id=$1 AND user_id=$2 AND status='trashed' AND previous_status<>'quarantined' AND trashed_at>now()-($3::int*interval '1 day')";
   if(!(await pool.query(sql,[id,user.id,config.TRASH_RETENTION_DAYS])).rowCount)throw failure(404,'Item unavailable.');return {ok:true};
  });
  app.delete(`/v1/trash/${kind}/:id`,async(req,reply)=>{
   const user=await requireUser(req,reply);if(!user)return;const {id}=parse(z.object({id:z.uuid()}),req.params);
   if(kind==='documents'){
    if(!(await pool.query('DELETE FROM documents WHERE id=$1 AND user_id=$2 AND trashed_at IS NOT NULL',[id,user.id])).rowCount)throw failure(404,'Item unavailable.');
   }else{
    if(!(await pool.query("SELECT id FROM resources WHERE id=$1 AND user_id=$2 AND status='trashed'",[id,user.id])).rowCount || !await queuePurge(id,user.id))throw failure(404,'Item unavailable.');
   }return {ok:true};
  });
 }
}
