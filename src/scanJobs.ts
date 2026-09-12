import {randomUUID,createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {pool} from './db.js';
import {transaction} from './transactions.js';
import {objectStore} from './storage.js';
import {privateTemp} from './tempFiles.js';
import {validateFilePath} from './fileValidation.js';
import {scanner} from './scanner.js';
import {config} from './config.js';
export async function runScanJobs(max=2){
 if(config.MALWARE_SCANNER_MODE==='disabled')return;
 for(let n=0;n<max;n++){
  const lease=randomUUID();
  const job=(await pool.query("UPDATE jobs SET lease_token=$1,lease_until=now()+interval '5 minutes',attempts=attempts+1 WHERE id=(SELECT id FROM jobs WHERE state='pending' AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",[lease])).rows[0];
  if(!job)return;
  const row=(await pool.query("UPDATE resources SET status='scanning' WHERE id=$1 AND status IN ('pending_validation','pending_scan','scanning','scan_failed') RETURNING *",[job.resource_id])).rows[0];
  if(!row){await pool.query("UPDATE jobs SET state='done',lease_until=NULL WHERE id=$1 AND lease_token=$2",[job.id,lease]);continue;}
  try{
   await privateTemp(async path=>{
    let size=0;const hash=createHash('sha256');
    await pipeline(await objectStore().stream(row.object_key),new Transform({transform(chunk,encoding,done){size+=chunk.length;if(size>config.UPLOAD_MAX_BYTES)return done(new Error('File size limit'));hash.update(chunk);done(null,chunk);}}),createWriteStream(path,{flags:'wx',mode:0o600}),{signal:AbortSignal.timeout(60000)});
    if(size!==Number(row.size_bytes) || (row.content_sha256 && row.content_sha256!==hash.digest('hex')))throw Object.assign(new Error('Invalid content'),{unsafe:true});
    let validation;try{validation=await validateFilePath(path,row.original_name,row.mime);}catch{throw Object.assign(new Error('Invalid format'),{unsafe:true});}
    const scan=await scanner().scan(path);
    if(scan.privacy!=='PRIVATE'||scan.status==='ERROR')throw new Error('Private scanner unavailable');
    await transaction(async c=>{
     const current=await c.query("UPDATE jobs SET state='done',lease_until=NULL WHERE id=$1 AND lease_token=$2 AND state='pending' RETURNING id",[job.id,lease]);if(!current.rowCount)return;
     await c.query("UPDATE resources SET status=$2,mime=$3,reader_content=$4,scan_engine=$5,scanned_at=now(),detection=$6 WHERE id=$1 AND status='scanning'",[row.id,scan.status==='CLEAN'?'ready':'quarantined',validation.mime,scan.status==='CLEAN'?validation.reader??null:null,scan.engine,scan.detection??null]);
    });
   });
  }catch(error){
   const unsafe=error && typeof error==='object' && 'unsafe' in error,dead=unsafe||job.attempts>=4;
   await transaction(async c=>{
    const current=await c.query("UPDATE jobs SET state=$3,lease_until=NULL,available_at=now()+($4::int*interval '1 second') WHERE id=$1 AND lease_token=$2 AND state='pending' RETURNING id",[job.id,lease,dead?'dead':'pending',[30,120,600][Math.min(job.attempts-1,2)]]);if(!current.rowCount)return;
    await c.query("UPDATE resources SET status=$2,scanned_at=CASE WHEN $3 THEN now() ELSE scanned_at END,detection=CASE WHEN $3 THEN 'unsafe-format' ELSE NULL END WHERE id=$1 AND status='scanning'",[row.id,unsafe?'quarantined':dead?'scan_failed':'pending_scan',Boolean(unsafe)]);
   });
  }
 }
}
