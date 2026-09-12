export async function mountReader({root,item,resume,el,api,onPage}){
 let cleanup=()=>{};
 if(item.mime==='application/pdf'){
  const pdfjs=await import('./vendor/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
  const task=pdfjs.getDocument({url:`/v1/resources/${item.id}/content`,withCredentials:true,isEvalSupported:false,enableXfa:false,disableAutoFetch:true,disableStream:true,disableRange:true,useWorkerFetch:false,maxImageSize:16000000});
  const pdf=await task.promise;let current=Math.min(pdf.numPages,Math.max(1,Number(resume.page)||1)),rendering=false;
  const canvas=el('canvas',{'aria-label':'PDF page',role:'img'}),label=el('p',{role:'status'});
  const render=async()=>{if(rendering)return;rendering=true;try{const page=await pdf.getPage(current),base=page.getViewport({scale:1}),scale=Math.min(2,Math.max(0.3,(root.clientWidth-32||700)/base.width)),viewport=page.getViewport({scale});canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport}).promise;label.textContent=`Page ${current} of ${pdf.numPages}`;onPage(current);page.cleanup();}finally{rendering=false;}};
  const move=delta=>async()=>{if(rendering)return;current=Math.min(pdf.numPages,Math.max(1,current+delta));await render();};
  root.replaceChildren(el('div',{class:'btn-row'},[el('button',{class:'btn btn--ghost',onclick:move(-1)},'Previous page'),label,el('button',{class:'btn btn--ghost',onclick:move(1)},'Next page')]),canvas);
  cleanup=()=>{void task.destroy();};await render();
 }else if(item.mime.startsWith('image/')){
  root.replaceChildren(el('img',{src:`/v1/resources/${item.id}/content`,alt:item.title,loading:'lazy'}));
 }else{
  const data=await api(`/v1/resources/${item.id}/preview`);
  root.replaceChildren(...data.sections.map((section,index)=>el('section',{},[el('h2',{},item.mime==='text/plain'?'Text':`Section ${index+1} · ${section.name}`),el('pre',{class:'text-reader',tabindex:0},section.text)])));
 }
 return cleanup;
}
