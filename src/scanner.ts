import {createConnection} from 'node:net';
import {createReadStream} from 'node:fs';
import {once} from 'node:events';
import {config} from './config.js';
export type ScanResult={status:'CLEAN'|'INFECTED'|'SUSPICIOUS'|'ERROR';engine:string;privacy:'PRIVATE';detection?:string};
export interface PrivateScanner {privacy:'PRIVATE';scan(path:string):Promise<ScanResult>}
export function scanner():PrivateScanner {
 return {privacy:'PRIVATE',async scan(path){
  if(config.MALWARE_SCANNER_MODE==='disabled')return {status:'ERROR',engine:'disabled',privacy:'PRIVATE'};
  if(config.MALWARE_SCANNER_MODE==='mock'){
   let carry='',infected=false,error=false;
   for await(const b of createReadStream(path)){carry=(carry+b.toString()).slice(-100000);infected ||= carry.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE');error ||=carry.includes('CHIX_TEST_SCANNER_ERROR');}
   return {status:error?'ERROR':infected?'INFECTED':'CLEAN',engine:'mock-test-only',privacy:'PRIVATE',...(infected?{detection:'test-signature'}:{})};
  }
  return new Promise<ScanResult>(resolve=>{
   const socket=createConnection({host:config.CLAMAV_HOST!,port:config.CLAMAV_PORT}),input=createReadStream(path,{highWaterMark:65536});
   let response='',finished=false;
   const finish=(status:ScanResult['status'],detection?:string)=>{if(finished)return;finished=true;clearTimeout(deadline);input.destroy();socket.destroy();resolve({status,engine:'clamav',privacy:'PRIVATE',...(detection?{detection}:{})});};
   const deadline=setTimeout(()=>finish('ERROR'),60000);
   socket.on('error',()=>finish('ERROR'));input.on('error',()=>finish('ERROR'));
   socket.on('data',chunk=>{response+=chunk.toString('utf8');if(response.length>4096)return finish('ERROR');if(response.includes('\0')){const result=response.split('\0')[0];if(result==='stream: OK')finish('CLEAN');else if(/^stream: .+ FOUND$/.test(result!))finish('INFECTED',result!.slice(8,-6).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100));else finish('ERROR');}});
   socket.on('close',()=>{if(!finished)finish('ERROR');});
   socket.on('connect',()=>{void(async()=>{
    socket.write('zINSTREAM\0');
    for await(const chunk of input){if(finished)return;const header=Buffer.alloc(4);header.writeUInt32BE(chunk.length);socket.write(header);if(!socket.write(chunk))await once(socket,'drain');}
    if(!finished)socket.write(Buffer.alloc(4));
   })().catch(()=>finish('ERROR'));});
  });
 }};
}
