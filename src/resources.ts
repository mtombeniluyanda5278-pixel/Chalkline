import type {FastifyInstance} from 'fastify';
import multipart from '@fastify/multipart';
import {randomUUID,createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {z} from 'zod';
import {requireUser} from './auth.js';
import {pool} from './db.js';
import {transaction} from './transactions.js';
import {objectStore} from './storage.js';
import {config} from './config.js';
import {failure,itemId,parse,limit} from './http.js';
import {safeFilename} from './fileValidation.js';
import {privateTemp} from './tempFiles.js';
import {reserveUpload,usage} from './quota.js';
import {transferLease} from './concurrency.js';
export async function registerResourceRoutes(app:FastifyInstance){
 await app.register(multipart,{limits:{fileSize:config.UPLOAD_MAX_BYTES,files:1,fields:0,parts:1}});
 app.post('/v1/resources',{bodyLimit:config.UPLOAD_MAX_BYTES+16384},async(req,reply)=>{
  const user=await requireUser(req,reply);if(!user)return;await limit('upload',user.id);
  if(config.MALWARE_SCANNER_MODE==='disabled')throw failure(503,'Uploads are paused until private scanning is configured.');
  const release=await transferLease('upload',user.id);let id:string|undefined;
  try{return await privateTemp(async path=>{
   const file=await req.file();if(!file)throw failure(400,'Choose a file.');
   const name=safeFilename(file.filename),reservation=Number(req.headers['x-file-size']??Math.min(Number(req.headers['content-length'])||config.UPLOAD_MAX_BYTES,config.UPLOAD_MAX_BYTES));
   if(!Number.isSafeInteger(reservation)||reservation<1||reservation>config.UPLOAD_MAX_BYTES)throw failure(413,'Invalid file size.');
   id=randomUUID();const key=`users/${user.id}/${id}`;
   await transaction(async c=>{
    await reserveUpload(c,user.id,reservation);
    await c.query("INSERT INTO resources(id,user_id,object_key,original_name,title,mime,size_bytes) VALUES($1,$2,$3,$4,$4,$5,$6)",[id,user.id,key,name,file.mimetype,reservation]);
   });
   let size=0;const hash=createHash('sha256');
   await pipeline(file.file,new Transform({transform(chunk,encoding,done){size+=chunk.length;if(size>reservation)return done(failure(413,'File exceeds the declared size.'));hash.update(chunk);done(null,chunk);}}),createWriteStream(path,{flags:'wx',mode:0o600}),{signal:AbortSignal.timeout(60000)});
   if(file.file.truncated||!size)throw failure(413,'Upload is empty or too large.');
   await objectStore().put(key,createReadStream(path),size);
   const item=await transaction(async c=>{
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
    const r=await c.query("UPDATE resources SET size_bytes=$3,content_sha256=$4,status='pending_validation' WHERE id=$1 AND user_id=$2 AND status='uploading' RETURNING id,title,mime,size_bytes,status",[id,user.id,size,hash.digest('hex')]);
    if(!r.rowCount)throw failure(409,'Upload cancelled.');
    await c.query('UPDATE user_usage SET storage_reserved_bytes=storage_reserved_bytes-$2,storage_used_bytes=storage_used_bytes+$3 WHERE user_id=$1',[user.id,reservation,size]);
    await c.query("INSERT INTO jobs(kind,resource_id,dedupe_key) VALUES('scan',$1,$2)",[id,`scan:${id}`]);
    return r.rows[0];
   });
   return reply.code(202).send({item});
  });}catch(error){
   if(id)await transaction(async c=>{
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
    const r=await c.query("DELETE FROM resources WHERE id=$1 AND user_id=$2 AND status='uploading' RETURNING size_bytes",[id,user.id]);
    if(r.rowCount)await c.query('UPDATE user_usage SET storage_reserved_bytes=storage_reserved_bytes-$2 WHERE user_id=$1',[user.id,r.rows[0].size_bytes]);
   });throw error;
  }finally{await release();}
 });
 app.get('/v1/resources',async(req,reply)=>{
  const user=await requireUser(req,reply);if(!user)return;await limit('search',user.id);
  const q=parse(z.object({search:z.string().max(200).default(''),type:z.enum(['all','image','document','text']).default('all'),sort:z.enum(['recent','name','size']).default('recent'),offset:z.coerce.number().int().min(0).default(0)}),req.query);
  const order={recent:'created_at DESC',name:'title ASC',size:'size_bytes DESC'}[q.sort];
  return {items:(await pool.query(`SELECT id,title,mime,size_bytes,status,created_at FROM resources WHERE user_id=$1 AND status NOT IN ('uploading','trashed','deleting','deleted') AND title ILIKE $2 AND ($3='all' OR ($3='image' AND mime LIKE 'image/%') OR ($3='text' AND mime='text/plain') OR ($3='document' AND mime LIKE 'application/%')) ORDER BY ${order},id LIMIT 20 OFFSET $4`,[user.id,'%'+q.search+'%',q.type,q.offset])).rows,uploadMaxBytes:config.UPLOAD_MAX_BYTES,usage:await usage(user.id)};
 });
 app.get('/v1/resources/:id',async(req,reply)=>{
  const user=await requireUser(req,reply);if(!user)return;
  const row=(await pool.query("SELECT id,title,mime,size_bytes,status,created_at FROM resources WHERE id=$1 AND user_id=$2 AND status NOT IN ('trashed','deleting','deleted')",[itemId(req),user.id])).rows[0];if(!row)throw failure(404,'File not found.');
  return {item:row,resume:(await pool.query('SELECT state FROM resume_state WHERE resource_id=$1 AND user_id=$2',[row.id,user.id])).rows[0]?.state??{}};
 });
 for(const route of ['download','content'] as const)app.get(`/v1/resources/:id/${route}`,async(req,reply)=>{
  const user=await requireUser(req,reply);if(!user)return;await limit('download',user.id);
  const row=(await pool.query("SELECT object_key,original_name,mime FROM resources WHERE id=$1 AND user_id=$2 AND status='ready' AND scanned_at IS NOT NULL",[itemId(req),user.id])).rows[0];if(!row)throw failure(404,'File unavailable.');
  const release=await transferLease('download',user.id);
  try{
   const stream=await objectStore().stream(row.object_key);let released=false;const done=()=>{if(!released){released=true;void release().catch(()=>{});}};
   stream.once('close',done);stream.once('error',done);reply.raw.once('close',()=>{stream.destroy();done();});
   reply.header('Content-Disposition',`${route==='download'?'attachment':'inline'}; filename="download"; filename*=UTF-8''${encodeURIComponent(row.original_name).replace(/'/g,'%27')}`);
   reply.header('Content-Security-Policy',"sandbox; default-src 'none'");return reply.type(route==='download'?'application/octet-stream':row.mime).send(stream);
  }catch(error){await release();throw error;}
 });
 app.get('/v1/resources/:id/preview',async(req,reply)=>{
  const user=await requireUser(req,reply);if(!user)return;await limit('download',user.id);
  const row=(await pool.query("SELECT mime,reader_content FROM resources WHERE id=$1 AND user_id=$2 AND status='ready' AND scanned_at IS NOT NULL",[itemId(req),user.id])).rows[0];if(!row)throw failure(404,'File unavailable.');
  return {mime:row.mime,sections:row.reader_content?.sections??[],text:row.mime==='text/plain'?row.reader_content?.sections?.[0]?.text:undefined,contentUrl:`/v1/resources/${itemId(req)}/content`};
 });
 app.patch('/v1/resources/:id',async(req,reply)=>{
  const user=await requireUser(req,reply);if(!user)return;const b=parse(z.strictObject({title:z.string().trim().min(1).max(200)}),req.body);
  const r=await pool.query("UPDATE resources SET title=$3,updated_at=now() WHERE id=$1 AND user_id=$2 AND status NOT IN ('trashed','deleting','deleted')",[itemId(req),user.id,b.title]);if(!r.rowCount)throw failure(404,'File not found.');return {ok:true};
 });
 app.delete('/v1/resources/:id',async(req,reply)=>{
  const user=await requireUser(req,reply);if(!user)return;
  const r=await pool.query("UPDATE resources SET previous_status=status,status='trashed',trashed_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('ready','scan_failed','quarantined')",[itemId(req),user.id]);if(!r.rowCount)throw failure(404,'File unavailable.');return {ok:true};
 });
}
