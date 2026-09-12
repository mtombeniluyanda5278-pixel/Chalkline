import type {PoolClient} from 'pg';
import {pool} from './db.js';
import {config} from './config.js';
import {failure} from './http.js';
export async function configurePlans() {
 await pool.query("UPDATE plans SET storage_quota_bytes=$1,document_quota_bytes=$2,upload_max_bytes=$3 WHERE code='FREE_BETA'",[config.STORAGE_USER_QUOTA_BYTES,config.FREE_DOCUMENT_QUOTA_BYTES,config.UPLOAD_MAX_BYTES]);
 await pool.query("UPDATE plans SET storage_quota_bytes=$1,document_quota_bytes=$2,upload_max_bytes=0 WHERE code='UNVERIFIED'",[config.UNVERIFIED_FILE_STORAGE_QUOTA_BYTES,config.UNVERIFIED_DOCUMENT_QUOTA_BYTES]);
}
export async function usage(userId:string,c:PoolClient|typeof pool=pool) {
 await c.query('INSERT INTO user_usage(user_id) VALUES($1) ON CONFLICT DO NOTHING',[userId]);
 return (await c.query("SELECT x.*,p.*,u.email_verified_at IS NOT NULL AS verified FROM user_usage x JOIN users u ON u.id=x.user_id LEFT JOIN user_plan_assignments a ON a.user_id=u.id JOIN plans p ON p.code=CASE WHEN u.email_verified_at IS NULL THEN 'UNVERIFIED' ELSE coalesce(a.plan_code,'FREE_BETA') END WHERE x.user_id=$1",[userId])).rows[0];
}
export async function reserveUpload(c:PoolClient,userId:string,bytes:number) {
 await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
 const q=await usage(userId,c);
 if(!q.verified)throw failure(403,'Verify your email to upload files. You can keep working on notes and lessons.');
 if(bytes>Number(q.upload_max_bytes))throw failure(413,'File exceeds your plan limit.');
 const r=await c.query('UPDATE user_usage SET storage_reserved_bytes=storage_reserved_bytes+$2 WHERE user_id=$1 AND storage_used_bytes+storage_reserved_bytes+$2<=$3 RETURNING user_id',[userId,bytes,q.storage_quota_bytes]);
 if(!r.rowCount)throw failure(413,'Storage quota reached. Permanently purge unused files to free space.');
}
