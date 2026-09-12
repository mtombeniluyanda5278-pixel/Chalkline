import {mkdtemp,rm,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
export async function privateTemp<T>(work:(path:string)=>Promise<T>):Promise<T>{
 const dir=await mkdtemp(join(tmpdir(),'chix-private-'));await chmod(dir,0o700);
 try{return await work(join(dir,'content'));}finally{await rm(dir,{recursive:true,force:true});}
}
