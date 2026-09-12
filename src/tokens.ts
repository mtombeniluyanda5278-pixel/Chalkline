import { randomBytes, createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { deliverDevOrLogEmail } from './mail.js';
import { config } from './config.js';
import { failure } from './http.js';
export type Purpose = 'verify_email'|'reset_password'|'verify_recovery'|'change_email'|'account_discovery';
const policy = {
 verify_email: {minutes:1440, route:'verify-email'}, reset_password:{minutes:15, route:'reset-password'},
 verify_recovery:{minutes:30,route:'verify-recovery'},change_email:{minutes:30,route:'change-email'},account_discovery:{minutes:15,route:'discover-account'}
} as const;
const digest=(raw:string)=>createHash('sha256').update(raw).digest();
// Caller holds the user lock. Rotation and encrypted delivery always share its transaction.
export async function issueEmailToken(c: PoolClient,userId:string,purpose:Purpose,target:string,channel:'primary'|'recovery'='primary') {
 const raw=randomBytes(32).toString('base64url');
 await c.query('UPDATE email_tokens SET used_at=now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL',[userId,purpose]);
 const row=(await c.query("INSERT INTO email_tokens(user_id,purpose,target_email,channel,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+($6::int*interval '1 minute')) RETURNING id",[userId,purpose,target,channel,digest(raw),policy[purpose].minutes])).rows[0];
 await deliverDevOrLogEmail({userId,to:target,subject:`Chix: ${purpose.replaceAll('_',' ')}`,body:`Continue securely: ${config.WEBAUTHN_ORIGIN}/#/${policy[purpose].route}?token=${encodeURIComponent(raw)}\nThis link expires in ${policy[purpose].minutes} minutes. If you did not request it, ignore this email.`},c,`token:${row.id}`);
 await c.query("UPDATE notification_outbox SET expires_at=now()+($2::int*interval '1 minute') WHERE dedupe_key=$1",[`token:${row.id}`,policy[purpose].minutes]);
 return raw;
}
export async function consumeEmailToken(c: PoolClient,raw:string,purpose:Purpose) {
 const hint=(await c.query('SELECT user_id FROM email_tokens WHERE token_hash=$1 AND purpose=$2',[digest(raw),purpose])).rows[0];
 if(!hint) throw failure(400,'Invalid or expired link.');
 const user=(await c.query('SELECT * FROM users WHERE id=$1 AND suspended_at IS NULL FOR UPDATE',[hint.user_id])).rows[0];
 if(!user) throw failure(400,'Invalid or expired link.');
 const token=(await c.query('UPDATE email_tokens SET used_at=now() WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at>now() RETURNING *',[digest(raw),purpose])).rows[0];
 if(!token) throw failure(400,'Invalid or expired link.');
 // Throwing rolls consumption back alongside the protected action.
 if(purpose==='verify_email' && String(user.email).toLowerCase()!==String(token.target_email).toLowerCase()) throw failure(400,'Invalid or expired link.');
 if(purpose==='reset_password' && String(token.channel==='primary'?user.email:user.recovery_email).toLowerCase()!==String(token.target_email).toLowerCase()) throw failure(400,'Invalid or expired link.');
 return {token,user};
}
