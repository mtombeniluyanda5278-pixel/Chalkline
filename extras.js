let ui;
export const setupExtras = (helpers) => { ui = helpers; };
const E = (...args) => ui.el(...args);
const api = (...args) => ui.apiFetch(...args);
const button = (text, action) => E('button', {type:'button',class:'btn btn--ghost',onclick:async e=>{e.currentTarget.disabled=true;try{await action();}catch(err){ui.toast(ui.friendlyError(err),'error');}finally{e.currentTarget.disabled=false;}}},text);
const link = (text,path) => E('a',{href:'#/'+path,class:'btn btn--ghost'},text);
function field(label,value='',type='text') {const f=ui.field({label,type});f.input.value=value;return f;}
function select(label,values,value) {const input=E('select',{'aria-label':label},values.map(v=>E('option',{value:v},v)));input.value=value??values[0];return {input,wrapper:E('label',{},[E('span',{},label),input])};}
let botConfig,scriptPromise;
async function config(){return botConfig ??= (await api('/v1/config')).bot;}
export async function mountBot(container,action){
 const cfg=await config();let token='';
 if(cfg.provider==='disabled'){container.append(E('p',{},'Human verification is not configured.'));return ()=>token;}
 if(cfg.provider==='mock'){
  const input=E('input',{type:'checkbox'});input.addEventListener('change',()=>{token=input.checked?'mock-human':'';});container.append(E('label',{},[input,E('span',{},'Human verification (local test provider)')]));return ()=>token;
 }
 const provider=cfg.provider==='turnstile'?'turnstile':'hcaptcha';
 scriptPromise ??= new Promise((resolve,reject)=>{const script=E('script',{src:provider==='turnstile'?'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit':'https://js.hcaptcha.com/1/api.js?render=explicit',async:true});script.onload=resolve;script.onerror=()=>reject(new Error('Unable to load human verification.'));document.head.append(script);});
 await scriptPromise;
 window[provider].render(container,{sitekey:cfg.siteKey,action,callback:value=>{token=value;},'expired-callback':()=>{token='';},'error-callback':()=>{token='';}});
 return ()=>token;
}
export async function humanProof(action){
 return new Promise((resolve,reject)=>{
  const dialog=E('dialog',{'aria-label':'Human verification'}),container=E('div',{});let read=()=>'';
  const done=()=>{dialog.close();dialog.remove();};
  dialog.append(E('h2',{},'A quick human check'),container,button('Continue',async()=>{if(!read())return;const token=read();done();resolve(token);}),button('Cancel',async()=>{done();reject(new Error('Verification cancelled.'));}));
  dialog.addEventListener('cancel',()=>{dialog.remove();reject(new Error('Verification cancelled.'));});document.body.append(dialog);dialog.showModal();mountBot(container,action).then(r=>{read=r;}).catch(e=>{done();reject(e);});
 });
}
export async function renderPreferences(){
 const data=await api('/v1/me/preferences'),recovery=await api('/v1/me/recovery-email');
 const days=select('Stay signed in for (days)',['1','7','30','90'],String(data.sessionDays)),zone=field('Timezone',data.timezone),touch=E('input',{type:'checkbox'});touch.checked=data.personalTouches;
 const email=field('New recovery email','','email');
 ui.viewRoot.append(E('h1',{},'Your preferences'),E('section',{class:'card form'},[days.wrapper,zone.wrapper,E('label',{},[touch,E('span',{},'Personal touches and birthday greetings')]),button('Save preferences',async()=>{await api('/v1/me/preferences',{method:'PATCH',body:{sessionDays:Number(days.input.value),timezone:zone.input.value,personalTouches:touch.checked}});ui.toast('Preferences saved. Session duration applies at next sign-in.','success');}),link('Edit teaching profile','onboarding')]),E('section',{class:'card form'},[E('h2',{},'Recovery email'),E('p',{},recovery.email?`Verified: ${recovery.email}`:'No recovery email configured.'),...(recovery.pendingEmail?[E('p',{},`Awaiting verification: ${recovery.pendingEmail}`)]:[]),email.wrapper,button('Send verification link',async()=>{await ui.withReauth(()=>api('/v1/me/recovery-email',{method:'POST',body:{email:email.input.value}}));ui.toast('Check that address for a verification link.','success');}),button('Remove recovery email',async()=>{const result=await ui.confirmDialog({title:'Remove recovery email?',body:'Keep another working sign-in or recovery method.',confirmLabel:'Remove'});if(result.confirmed){await ui.withReauth(()=>api('/v1/me/recovery-email',{method:'DELETE'}));ui.navigate('/preferences');}})]));
}
export async function renderOnboarding(){
 const data=await api('/v1/me/preferences'),p=data.profile??{};
 const type=select('How do you teach?',['school','tutor','homeschool','lecturer_future','other'],p.educatorType),curriculum=select('Curriculum',['CAPS','IEB','Cambridge','custom'],p.curriculum),custom=field('Custom curriculum',p.customCurriculum),zone=field('Timezone',data.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone),grades=field('Grades (comma separated)',(p.grades??[]).join(', ')),subjects=field('Subjects (comma separated)',(p.subjects??[]).join(', '));
 const phases=['Foundation','Intermediate','Senior','FET','Other'].map(name=>{const input=E('input',{type:'checkbox',value:name});input.checked=p.phases?.includes(name)??false;return {name,input,wrapper:E('label',{},[input,E('span',{},name+({Foundation:' · R–3',Intermediate:' · 4–6',Senior:' · 7–9',FET:' · 10–12',Other:''}[name]))])};});
 const steps=[E('div',{class:'form'},[type.wrapper,zone.wrapper]),E('div',{class:'form'},[curriculum.wrapper,custom.wrapper,...phases.map(p=>p.wrapper)]),E('div',{class:'form'},[grades.wrapper,subjects.wrapper])];let step=0;
 const status=E('p',{role:'status'}),body=E('div',{}),next=button('Continue',async()=>{if(step<2){step++;render();return;}const split=v=>v.split(',').map(x=>x.trim()).filter(Boolean);await api('/v1/me/preferences',{method:'PATCH',body:{timezone:zone.input.value,profile:{educatorType:type.input.value,curriculum:curriculum.input.value,customCurriculum:custom.input.value,phases:phases.filter(p=>p.input.checked).map(p=>p.name),grades:split(grades.input.value),subjects:split(subjects.input.value)}}});ui.navigate('/dashboard');});
 const render=()=>{status.textContent=`Step ${step+1} of 3`;body.replaceChildren(steps[step]);next.textContent=step===2?'Save teaching profile':'Continue';};render();
 ui.viewRoot.append(E('h1',{},'Make Chix yours'),E('p',{},'Choose the teaching context you want to work with. You can edit this later.'),E('section',{class:'card form'},[status,body,E('div',{class:'btn-row'},[button('Back',async()=>{if(step>0){step--;render();}}),next])]),link('Do this later','dashboard'));
}
export async function renderRecoveryLink(params){
 const token=params.get('token')??'',path=location.hash.split('?')[0];history.replaceState(null,'',location.pathname+location.search+path);
 const route={'#/verify-recovery':'/v1/auth/verify-recovery','#/change-email':'/v1/auth/change-email','#/discover-account':'/v1/auth/account-discovery/confirm'}[path];
 const status=E('p',{role:'status'},'Use this link once to complete your request.');
 ui.viewRoot.append(E('h1',{},'Secure account recovery'),status,button('Continue',async()=>{const result=await api(route,{method:'POST',body:{token}});status.textContent=result.email?`Your primary email is ${result.email}. You can request a password reset using your verified recovery email.`:'Confirmed. You can sign in now.';}),link('Sign in','login'),link('Reset password','forgot-password'));
}
export async function renderDiscovery(){
 const email=field('Verified recovery email','','email'),username=field('Username (optional)'),status=E('p',{role:'status'});
 ui.viewRoot.append(E('h1',{},'Forgot your sign-in email?'),E('section',{class:'card form'},[email.wrapper,username.wrapper,button('Send recovery link',async()=>{const result=await api('/v1/auth/account-discovery/request',{method:'POST',body:{recoveryEmail:email.input.value,username:username.input.value||undefined}});status.textContent=result.message;}),status]));
}
export async function renderFeedback(){
 const category=select('Category',['bug','feature','usability','content','other']),message=E('textarea',{'aria-label':'Your feedback',minlength:10,maxlength:4000,rows:8}),opt=E('input',{type:'checkbox'}),status=E('p',{role:'status'});
 ui.viewRoot.append(E('h1',{},'Help shape Chix'),E('section',{class:'card form'},[category.wrapper,E('label',{},[E('span',{},'Your feedback'),message]),E('label',{},[opt,E('span',{},'Include basic diagnostics: version, page, browser/OS family, screen size and time. No document content or account details.')]),button('Send feedback',async()=>{const ua=navigator.userAgent;await api('/v1/feedback',{method:'POST',body:{category:category.input.value,message:message.value,includeDiagnostics:opt.checked,...(opt.checked?{diagnostics:{appVersion:'0.1.0',route:'feedback',browser:/Edg/.test(ua)?'Edge':/Chrome/.test(ua)?'Chrome':/Firefox/.test(ua)?'Firefox':/Safari/.test(ua)?'Safari':'Other',os:/Android/.test(ua)?'Android':/iPhone|iPad/.test(ua)?'iOS':/Mac/.test(ua)?'macOS':/Windows/.test(ua)?'Windows':/Linux/.test(ua)?'Linux':'Other',viewport:{width:innerWidth,height:innerHeight},timestamp:new Date().toISOString()}}:{})}});status.textContent='Feedback received. Thank you.';message.value='';}),status]));
 const result=await api('/v1/feedback');ui.viewRoot.append(E('h2',{},'Your feedback'),...result.items.map(item=>E('article',{class:'card'},[E('strong',{},`${item.category} · ${item.status}`),E('p',{},item.message)])));
}
export async function renderTrash(){
 const data=await api('/v1/trash');ui.viewRoot.append(E('h1',{},'Trash'),E('p',{},'Items remain for 30 days and continue to count toward your quota until purged.'));
 for(const item of data.items){const route='/v1/trash/'+(item.kind==='file'?'resources':'documents')+'/'+item.id;const row=E('article',{class:'card'},[E('h2',{},item.title),button('Restore',async()=>{await api(route+'/restore',{method:'POST'});row.remove();}),button('Permanently purge',async()=>{const result=await ui.confirmDialog({title:'Permanently purge?',body:'This cannot be undone. File storage is released after physical deletion.',danger:true,confirmLabel:'Purge'});if(result.confirmed){await api(route,{method:'DELETE'});row.remove();}})]);ui.viewRoot.append(row);}
}
export async function renderAdmin(){
 const users=await ui.withReauth(()=>api('/v1/admin/users')),feedback=await api('/v1/admin/feedback'),jobs=await api('/v1/admin/jobs');
 ui.viewRoot.append(E('h1',{},'Chix administration'),E('p',{},'Account status only. Teacher documents remain private.'),E('h2',{},'Accounts'));
 for(const user of users.items)ui.viewRoot.append(E('article',{class:'card'},[E('strong',{},`${user.first_name} ${user.last_initial}.`),E('p',{},`${user.email} · Primary verified: ${user.primary_verified} · Recovery verified: ${user.recovery_verified} · Onboarded: ${user.onboarded} · Suspended: ${user.suspended}`),button('Reveal contact with reason',async()=>{const reason=field('Reason for contact access'),dialog=E('dialog',{});dialog.append(reason.wrapper,button('Reveal',async()=>{const r=await ui.withReauth(()=>api('/v1/admin/users/'+user.id+'/contact',{method:'POST',body:{reason:reason.input.value}}));dialog.append(E('p',{},r.email),E('p',{},r.recovery_email??''));}),button('Close',async()=>{dialog.close();dialog.remove();}));document.body.append(dialog);dialog.showModal();})]));
 ui.viewRoot.append(E('h2',{},'Feedback'));
 for(const f of feedback.items){const status=select('Status',['NEW','REVIEWING','PLANNED','RESOLVED','CLOSED'],f.status);ui.viewRoot.append(E('article',{class:'card'},[E('strong',{},f.category),E('p',{},f.message),status.wrapper,button('Save status',async()=>{await api('/v1/admin/feedback/'+f.id,{method:'PATCH',body:{status:status.input.value}});ui.toast('Status saved.','success');})]));}
 ui.viewRoot.append(E('h2',{},'Background work'),E('p',{},`${jobs.scans.length} pending or failed scan jobs.`));for(const job of jobs.scans)ui.viewRoot.append(E('div',{class:'entity-row'},[E('span',{},`${job.state} · attempts ${job.attempts}`),...(job.state==='dead'?[button('Retry failed scan',async()=>{await api('/v1/admin/jobs/'+job.id+'/retry',{method:'POST'});ui.toast('Retry queued.','success');})]:[])]));
}
