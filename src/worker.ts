import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {transaction} from './transactions.js';
import {objectStore,storageConfigured} from './storage.js';
import {decryptMail,emailAdapter} from './mail.js';
import {config} from './config.js';
import {runScanJobs} from './scanJobs.js';
export async function queuePurge(resourceId:string,userId?:string){
 return transaction(async c=>{
  const r=(await c.query("UPDATE resources SET status='deleting',reader_content=NULL WHERE id=$1 AND ($2::uuid IS NULL OR user_id=$2) AND status<>'uploading' RETURNING object_key",[resourceId,userId??null])).rows[0];
  if(!r)return false;
  await c.query("INSERT INTO object_deletions(object_key) VALUES($1) ON CONFLICT(object_key) DO UPDATE SET state='pending',available_at=now()",[r.object_key]);return true;
 });
}
export async function runMaintenance(){
 await runScanJobs();
 const stale=(await pool.query("SELECT id,user_id FROM resources WHERE status='uploading' AND created_at<now()-interval '1 hour' LIMIT 20")).rows;
 for(const row of stale)await transaction(async c=>{
  await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[row.user_id]);
  const deleted=(await c.query("DELETE FROM resources WHERE id=$1 AND status='uploading' RETURNING size_bytes",[row.id])).rows[0];
  if(deleted)await c.query('UPDATE user_usage SET storage_reserved_bytes=storage_reserved_bytes-$2 WHERE user_id=$1',[row.user_id,deleted.size_bytes]);
 });
 const purge=(await pool.query("SELECT id FROM resources WHERE ((status='quarantined' OR (status='trashed' AND previous_status='quarantined')) AND scanned_at<now()-($1::int*interval '1 hour')) OR (status='trashed' AND trashed_at<now()-($2::int*interval '1 day')) LIMIT 20",[config.MALWARE_QUARANTINE_RETENTION_HOURS,config.TRASH_RETENTION_DAYS])).rows;
 for(const row of purge)await queuePurge(row.id);
 await pool.query("DELETE FROM documents WHERE id IN (SELECT id FROM documents WHERE trashed_at<now()-($1::int*interval '1 day') LIMIT 100)",[config.TRASH_RETENTION_DAYS]);
 if(storageConfigured())for(let n=0;n<20;n++){
  const lease=randomUUID();
  const row=(await pool.query("UPDATE object_deletions SET lease_token=$1,lease_until=now()+interval '5 minutes' WHERE object_key=(SELECT object_key FROM object_deletions WHERE state='pending' AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",[lease])).rows[0];
  if(!row)break;
  try{
   await objectStore().delete(row.object_key);
   await transaction(async c=>{
    const current=await c.query('SELECT object_key FROM object_deletions WHERE object_key=$1 AND lease_token=$2 FOR UPDATE',[row.object_key,lease]);if(!current.rowCount)return;
    const resource=(await c.query("SELECT id,user_id,size_bytes FROM resources WHERE object_key=$1 AND status='deleting' FOR UPDATE",[row.object_key])).rows[0];
    if(resource){
     await c.query('UPDATE user_usage SET storage_used_bytes=storage_used_bytes-$2 WHERE user_id=$1',[resource.user_id,resource.size_bytes]);
     await c.query('DELETE FROM resources WHERE id=$1',[resource.id]);
    }
    // Tombstones recheck for delayed provider PUTs for an hour after creation.
    if(new Date(row.created_at).getTime()<Date.now()-3600000)await c.query('DELETE FROM object_deletions WHERE object_key=$1',[row.object_key]);
    else await c.query("UPDATE object_deletions SET lease_until=NULL,available_at=now()+interval '5 minutes' WHERE object_key=$1",[row.object_key]);
   });
  }catch{
   await pool.query("UPDATE object_deletions SET attempts=attempts+1,lease_until=NULL,state=CASE WHEN attempts>=11 THEN 'dead' ELSE 'pending' END,available_at=now()+(least(3600,30*power(2,least(attempts,7))) * interval '1 second') WHERE object_key=$1 AND lease_token=$2",[row.object_key,lease]);
  }
 }
 const adapter=emailAdapter();
 if(adapter)for(let n=0;n<20;n++){
  const lease=randomUUID();
  const row=(await pool.query("UPDATE notification_outbox SET lease_token=$1,lease_until=now()+interval '1 minute' WHERE id=(SELECT id FROM notification_outbox WHERE state='pending' AND recipient IS NOT NULL AND encrypted_body IS NOT NULL AND available_at<=now() AND expires_at>now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",[lease])).rows[0];
  if(!row)break;
  try{
   await adapter.send({to:row.recipient,subject:row.subject,body:decryptMail(row.encrypted_body),idempotencyKey:row.dedupe_key??`mail:${row.id}`});
   await pool.query("UPDATE notification_outbox SET state='sent',encrypted_body=NULL,recipient=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2",[row.id,lease]);
  }catch{
   await pool.query("UPDATE notification_outbox SET attempts=attempts+1,state=CASE WHEN attempts>=7 THEN 'dead' ELSE 'pending' END,lease_until=NULL,available_at=now()+(least(3600,30*power(2,attempts))*interval '1 second') WHERE id=$1 AND lease_token=$2",[row.id,lease]);
  }
 }
 await pool.query("DELETE FROM security_events WHERE investigation_hold=false AND created_at<now()-($1::int*interval '1 day')",[config.SECURITY_RETENTION_DAYS]);
 await pool.query("UPDATE notification_outbox SET encrypted_body=NULL,recipient=NULL,state='dead',lease_until=NULL WHERE expires_at<=now() AND state<>'sent' AND (encrypted_body IS NOT NULL OR recipient IS NOT NULL)");
 await pool.query("DELETE FROM document_revisions WHERE created_at<now()-interval '30 days'");
 await pool.query("DELETE FROM notification_outbox WHERE expires_at<now()-interval '30 days'");
 await pool.query("DELETE FROM device_challenges WHERE expires_at<now()-interval '1 day'");
 await pool.query("DELETE FROM sessions WHERE expires_at<=now() OR last_active_at+idle_seconds*interval '1 second'<=now()");
 await pool.query("DELETE FROM email_tokens WHERE expires_at<now()-interval '1 day'");
}
