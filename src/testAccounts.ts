// Test fixtures explicitly follow the emailed verification flow; raw registration
// privacy tests continue to call /v1/auth/register directly.
import assert from "node:assert/strict";
import type {FastifyInstance} from "fastify";
import {pool} from "./db.js";
import {decryptMail} from "./mail.js";
export async function verificationToken(email:string) {
 const row=(await pool.query("SELECT n.encrypted_body FROM notification_outbox n JOIN users u ON u.id=n.user_id WHERE u.email=$1 AND n.subject='Chix: verify email' ORDER BY n.created_at DESC LIMIT 1",[email])).rows[0];
 assert.ok(row,"verification mail was queued");
 return /token=([^\s]+)/.exec(decryptMail(row.encrypted_body))![1]!;
}
export async function registerVerifiedAccount(app:FastifyInstance,payload:any,verified=true) {
 const registered=await app.inject({method:"POST",url:"/v1/auth/register",payload});
 assert.equal(registered.statusCode,201,registered.body);
 assert.equal(registered.headers['set-cookie'],undefined);
 const token=await verificationToken(payload.email);
 const confirmation=await app.inject({method:"POST",url:"/v1/auth/verify-email",payload:{token}});
 assert.equal(confirmation.statusCode,200,confirmation.body);
 const cookie=[confirmation.headers['set-cookie']].flat().filter(Boolean).map(c=>c!.split(';')[0]).join('; ');
 if(!verified) await pool.query("UPDATE users SET email_verified_at=NULL WHERE email=$1",[payload.email]);
 const me=await app.inject({url:"/v1/me",headers:{cookie}});
 assert.equal(me.statusCode,200,me.body);
 // A fixture response combines verified identity and its issued browser cookies.
 me.statusCode=201;
 me.headers['set-cookie']=confirmation.headers['set-cookie'];
 return me;
}
