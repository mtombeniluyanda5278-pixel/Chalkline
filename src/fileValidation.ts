import {fileTypeFromFile} from 'file-type';
import {readFile,stat,writeFile} from 'node:fs/promises';
import yauzl from 'yauzl';
import {SaxesParser} from 'saxes';
import {failure} from './http.js';
import {config} from './config.js';
import {privateTemp} from './tempFiles.js';
const formats:Record<string,string>={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',txt:'text/plain'};
export function safeFilename(name:string){
 const value=name.normalize('NFKC').replace(/[\x00-\x1f\x7f-\x9f/\\<>:"|?*\u202a-\u202e\u2066-\u2069]/g,'_').trim();
 if(!value || value.length>200)throw failure(400,'Filename must contain 1–200 characters.');return value;
}
export type ReaderContent={sections:{name:string;text:string}[]};
export async function inspectOffice(path:string,extension:string):Promise<ReaderContent>{
 return new Promise((resolve,reject)=>{
  yauzl.open(path,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error,zip)=>{
   if(error || !zip)return reject(failure(400,'Invalid Office document.'));
   let count=0,total=0,textBytes=0,manifest=false,main=false,stopped=false;
   const seen=new Set<string>(),sections:ReaderContent['sections']=[],shared:string[]=[];
   const fail=()=>{if(stopped)return;stopped=true;zip.close();reject(failure(400,'Unsafe, malformed or oversized Office document.'));};
   zip.on('error',fail);
   zip.on('entry',entry=>{
    if(stopped)return;
    const name=entry.fileName.normalize('NFKC');count++;total+=entry.uncompressedSize;
    const mode=(entry.externalFileAttributes>>>16)&0xf000;
    if(count>config.OFFICE_MAX_ENTRIES || total>config.OFFICE_MAX_UNCOMPRESSED_BYTES || entry.uncompressedSize>config.OFFICE_MAX_ENTRY_BYTES || entry.uncompressedSize/Math.max(1,entry.compressedSize)>config.OFFICE_MAX_COMPRESSION_RATIO || entry.generalPurposeBitFlag&1 || mode===0xa000 || seen.has(name) || /(^|\/)\.\.(\/|$)|\\|^\/|^[a-z]:|\x00|vba|activeX|embeddings|\.bin$|\.exe$|\.dll$|\.js$|\.html?$|\.svg$/i.test(name))return fail();
    seen.add(name);
    if(!/\.(xml|rels)$/i.test(name)){zip.readEntry();return;}
    zip.openReadStream(entry,(err,stream)=>{
     if(err || !stream)return fail();
     let bytes=0,text='',root='',depth=0,collect=false,current='',cell='',sheetRows:string[]=[];
     const parser=new SaxesParser({xmlns:true});
     parser.on('error',fail);parser.on('doctype',fail);
     parser.on('opentag',tag=>{
      depth++;if(depth>200)return fail();if(!root)root=tag.local;
      for(const a of Object.values(tag.attributes))if(/macroEnabled|vbaProject|activeX|oleObject/i.test(a.value) || (a.local==='TargetMode' && a.value==='External'))return fail();
      if(tag.local==='t' || tag.local==='v'){collect=true;current='';}
      if(tag.local==='c')cell='';
     });
     parser.on('text',value=>{textBytes+=Buffer.byteLength(value);if(textBytes>config.OFFICE_MAX_EXTRACTED_TEXT_BYTES)return fail();if(collect)current+=value;});
     parser.on('closetag',tag=>{
      depth--;
      if(tag.local==='t' || tag.local==='v'){text+=current+' ';cell+=current;collect=false;}
      if(name==='xl/sharedStrings.xml' && tag.local==='si'){shared.push(text.trim());text='';}
      if(tag.local==='c')sheetRows.push(cell);
      if(['p','row'].includes(tag.local))text+='\n';
     });
     const decoder=new TextDecoder('utf-8',{fatal:true});
     stream.on('data',chunk=>{if(stopped){stream.destroy();return;}bytes+=chunk.length;if(bytes>config.OFFICE_MAX_ENTRY_BYTES)return fail();try{parser.write(decoder.decode(chunk,{stream:true}));}catch{fail();}});
     stream.on('error',fail);
     stream.on('end',()=>{
      if(stopped)return;try{parser.write(decoder.decode()).close();}catch{return fail();}
      if(name==='[Content_Types].xml'){if(root!=='Types')return fail();manifest=true;}
      const mainName={docx:'word/document.xml',pptx:'ppt/presentation.xml',xlsx:'xl/workbook.xml'}[extension];
      if(name===mainName){if(root!=={docx:'document',pptx:'presentation',xlsx:'workbook'}[extension])return fail();main=true;}
      if(name==='word/document.xml' || /^ppt\/slides\/slide\d+\.xml$/.test(name) || /^xl\/worksheets\/sheet\d+\.xml$/.test(name))sections.push({name,text:text.trim()});
      zip.readEntry();
     });
    });
   });
   zip.on('end',()=>{
    if(stopped)return;if(!manifest||!main)return fail();
    sections.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
    if(extension==='xlsx' && shared.length)sections.unshift({name:'Shared cell text',text:shared.join('\n')});
    stopped=true;resolve({sections});
   });zip.readEntry();
  });
 });
}
export async function validateFilePath(path:string,name:string,claimedMime:string){
 const ext=name.split('.').pop()?.toLowerCase()??'',mime=formats[ext],size=(await stat(path)).size;
 if(!mime||!size)throw failure(415,'Supported files: PDF, DOCX, PPTX, XLSX, TXT, PNG, JPEG and WebP.');
 const max=ext==='pdf'?config.FILE_MAX_PDF_BYTES:['docx','pptx','xlsx'].includes(ext)?config.FILE_MAX_OFFICE_BYTES:ext==='txt'?config.FILE_MAX_TEXT_BYTES:config.FILE_MAX_IMAGE_BYTES;
 if(size>Math.min(max,config.UPLOAD_MAX_BYTES))throw failure(413,'File exceeds the format size limit.');
 if(claimedMime && claimedMime!=='application/octet-stream' && claimedMime!==mime)throw failure(415,'File type does not match the upload.');
 let reader:ReaderContent|undefined;
 if(ext==='txt'){
  const body=await readFile(path);let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(body);}catch{throw failure(415,'Text files must be UTF-8.');}
  if(body.includes(0) || /<\s*(?:!doctype\s+html|html|script|svg)\b/i.test(text))throw failure(415,'Executable and HTML content is not accepted.');
  reader={sections:[{name:'Text',text}]};
 } else {
  const detected=await fileTypeFromFile(path);
  if(['docx','pptx','xlsx'].includes(ext))reader=await inspectOffice(path,ext);
  else if(detected?.mime!==mime)throw failure(415,'File content does not match its extension.');
  if(ext==='pdf'){
   // Bounded by the format cap. PDF.js parses and renders later with scripting disabled.
   const body=await readFile(path),text=body.toString('latin1');
   if(!/^%PDF-1\.[0-7]|^%PDF-2\.0/.test(text)||!text.slice(-2048).includes('%%EOF')||!text.includes('obj')||/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia)\b/.test(text))throw failure(415,'Invalid or active-content PDF.');
  }
 }
 return {mime,reader};
}
export async function validateFile(buffer:Buffer,name:string,mime:string){return privateTemp(async path=>{await writeFile(path,buffer,{mode:0o600});return (await validateFilePath(path,name,mime)).mime;});}
