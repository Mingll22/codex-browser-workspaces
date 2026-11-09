import {homedir} from 'node:os';
// HISTORICAL 0.3.x form/dialog/upload cases against installed stdio + real Chrome.
// Synthetic identities are unsupported by the 0.4 root-family resolver.
// Synthetic identities are test fixtures, never existing Codex thread identities.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {extensionTestClient} from '../scripts/extension-test-client.mjs';
import {openerTarget} from '../dist/adapter/src/target-identity.js';
const [configPath,out,anchor]=process.argv.slice(2);assert.ok(configPath&&out);
const config=JSON.parse(await readFile(configPath,'utf8'));
const baseline=await (await fetch(config.pairing.url.replace('ws:','http:')+'/health')).json();
assert.match(baseline.adapter??'',/^0\.3\./,'HISTORICAL_FIXTURE: synthetic dialog identities cannot run on 0.4; use its acceptance matrix');
const id=randomUUID(),fixtureRoot=process.env.CBW_WINDOWS_FIXTURE_ROOT;
assert.ok(fixtureRoot?.startsWith('/mnt/'),'Set CBW_WINDOWS_FIXTURE_ROOT to a disposable Windows-mounted test directory');
const mountFolder=join(fixtureRoot,`dialog-fixture-${id}`);
const {execFileSync}=await import('node:child_process');
const winFolder=execFileSync('wslpath',['-w',mountFolder],{encoding:'utf8'}).trim();
await mkdir(mountFolder,{recursive:true});
const linuxFile='/tmp/cbw-upload-'+id+'.txt';await writeFile(linuxFile,'linux '+id);
const files=[{name:'测试文档.txt',body:'dialog-upload-fixture 中文 '+id+'\n'},{name:'second.txt',body:'second '+id+'\n'}];
for(const f of files)await writeFile(join(mountFolder,f.name),f.body);
const receipts=[];
const html=`<!doctype html><meta charset="utf-8"><title>CBW Dialog Fixture</title>
<style>body{font:16px system-ui;max-width:920px;margin:30px;background:#f4f8fa;color:#152a3c}button,input,textarea{padding:10px;margin:5px;border:1px solid #8ba4b5;border-radius:6px}section{background:white;padding:16px;margin-bottom:14px;border-radius:12px}output{display:block;white-space:pre-wrap}dialog{border:1px solid #839dad;border-radius:12px}dialog::backdrop{background:#162d4580}</style>
<h1>Browser dialog / upload disposable fixture</h1>
<section><label>Draft<textarea aria-label="Draft"></textarea></label><button id="reload">Reload form</button><button id="clean">Clear dirty state</button></section>
<section><button id="alert">Alert</button><button id="confirm">Confirm</button><button id="prompt">Prompt</button><button id="modal">HTML modal</button><button id="popup">Open popup</button><button id="popupTab">Open popup tab</button><button id="ping">Ping</button></section>
<section><label>Direct file<input id="direct" type="file" aria-label="Direct file"></label><button id="sendDirect">Submit direct file</button>
<input id="proxyInput" type="file" hidden><button id="proxy">Choose proxy file</button><button id="sendProxy">Submit proxy file</button>
<label>Multiple files<input id="multi" type="file" multiple aria-label="Multiple files"></label><button id="sendMulti">Submit multiple files</button><output id="uploadResult"></output></section>
<dialog id="htmlModal"><h2>HTML confirmation</h2><button id="modalYes">Modal confirm</button><button id="modalNo">Modal cancel</button></dialog><output id="result"></output>
<script>
const draft=document.querySelector('textarea');let dirty=false;window.events=[];
window.loads=Number(sessionStorage.loads||0)+1;sessionStorage.loads=loads;
const log=(type,value)=>{events.push({type,value});document.querySelector('#result').textContent=JSON.stringify(events);};
draft.oninput=()=>dirty=!!draft.value;window.addEventListener('beforeunload',e=>{if(dirty){sessionStorage.unloadAttempts=Number(sessionStorage.unloadAttempts||0)+1;e.preventDefault();e.returnValue='';}});
document.querySelector('#reload').onclick=()=>location.reload();document.querySelector('#clean').onclick=()=>{dirty=false;draft.value='';};
document.querySelector('#alert').onclick=()=>{alert('Fixture alert');log('alert','continued');};
document.querySelector('#confirm').onclick=()=>log('confirm',confirm('Fixture confirmation?'));
document.querySelector('#prompt').onclick=()=>log('prompt',prompt('Fixture prompt','default'));
document.querySelector('#modal').onclick=()=>document.querySelector('dialog').showModal();
document.querySelector('#modalYes').onclick=()=>{log('modal',true);document.querySelector('dialog').close();};
document.querySelector('#modalNo').onclick=()=>{log('modal',false);document.querySelector('dialog').close();};
document.querySelector('#popupTab').onclick=()=>window.open('/popup','_blank');
document.querySelector('#popup').onclick=()=>window.open('/popup','_blank','width=600,height=400');
document.querySelector('#ping').onclick=()=>log('ping',true);
document.querySelector('#proxy').onclick=()=>document.querySelector('#proxyInput').click();
async function submit(id){const form=new FormData();for(const f of document.getElementById(id).files)form.append('files',f);const result=await fetch('/upload',{method:'POST',body:form}).then(r=>r.json());document.querySelector('#uploadResult').textContent=JSON.stringify(result);window.uploadResult=result;}
for(const [button,input] of [['sendDirect','direct'],['sendProxy','proxyInput'],['sendMulti','multi']])document.getElementById(button).onclick=()=>submit(input);
</script>`;
const server=createServer(async(req,res)=>{
 if(req.url==='/network-failure'){req.socket.destroy();return;}
 if(req.url==='/upload'&&req.method==='POST'){
  try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);const request=new Request('http://localhost/upload',{method:'POST',headers:req.headers,body});const form=await request.formData();const rows=[];for(const file of form.getAll('files'))rows.push({name:file.name,size:file.size,content:await file.text()});const receipt={sequence:receipts.length+1,files:rows};receipts.push(receipt);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(receipt));}catch(e){res.writeHead(500);res.end(e.message);}return;
 }
 res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'});res.end(req.url==='/popup'?'<title>Fixture popup</title><h1>Fixture popup</h1><button onclick="document.body.dataset.clicked=1">Popup action</button>':html);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;
const evidence={version:'0.3.0',layer:'real installed stdio + Windows Chrome; synthetic disposable identities; loopback upload receiver',url,fixtureWindowsPath:winFolder,fixtureMountPath:mountFolder,cases:[],calls:[],uploads:receipts};
const peers=[];const ext=await extensionTestClient(anchor);const orphanReceipts=[];
async function peer(){
 const thread=randomUUID(),client=new Client({name:'cbw-dialog-fixture',version:'0.3.0'});
 const transport=new StdioClientTransport({command:process.execPath,args:[join(process.env.XDG_DATA_HOME??join(homedir(),'.local/share'),'codex-browser-workspaces/dist/adapter/src/stdio.js'),configPath],cwd:mountFolder,stderr:'pipe'});transport.stderr?.on('data',()=>{});await client.connect(transport);
 const meta={threadId:thread,'x-codex-turn-metadata':{thread_id:thread,codex_version:'fixture'}};
 const raw=async(name,args={})=>{const start=Date.now();let r;try{r=await client.callTool({name,arguments:args,_meta:meta},undefined,{timeout:65000});}catch(e){r={isError:true,content:[{type:'text',text:e.message}]};}evidence.calls.push({thread,name,args,durationMs:Date.now()-start,result:r});return r;};
 const call=async(...args)=>{const r=await raw(...args);if(r.isError)throw Error(JSON.stringify(r));return r;};
 const json=async(...args)=>JSON.parse((await call(...args)).content[0].text);
 const f={thread,client,raw,call,json};peers.push(f);f.page=(await json('open_page',{url})).pageId;return f;
}
const text=r=>r.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
async function evaluate(p,fn,extra={}){const r=await p.call('evaluate_script',{pageId:p.page,function:fn,waitForStableDom:false,...extra});const match=text(r).match(/```json\n([\s\S]*?)\n```/);return match?JSON.parse(match[1]):text(r);}
async function uid(p,label){const snapshot=text(await p.call('take_snapshot',{pageId:p.page}));const line=snapshot.split('\n').find(l=>l.includes('"'+label+'"')&&/ (button|textbox|combobox|checkbox) /.test(l));assert.ok(line,'Missing fixture element '+label);return line.match(/uid=(\S+)/)[1];}
async function click(p,label){return p.raw('click',{pageId:p.page,uid:await uid(p,label)});}
async function state(p){return evaluate(p,'()=>({loads,attempts:Number(sessionStorage.unloadAttempts||0),draft:document.querySelector("textarea").value,events,files:[...document.querySelector("#direct").files].map(f=>({name:f.name,size:f.size})),uploadResult:window.uploadResult})');}
async function settleUpload(p,label){const count=receipts.length;const r=await click(p,label);assert.ok(!r.isError,text(r));for(let n=0;n<30&&receipts.length===count;n++)await new Promise(r=>setTimeout(r,100));assert.equal(receipts.length,count+1);return receipts.at(-1);}
async function testcase(name,fn){if(process.argv.includes('--navigation-only')&&!/navigate_page/.test(name))return;if(process.argv.includes('--uploads-only')&&!/file|upload/.test(name))return;if(process.argv.includes('--popups-only')&&!/Open popup/.test(name))return;const start=Date.now();try{const result=await fn();evidence.cases.push({name,pass:true,durationMs:Date.now()-start,result});console.log('PASS',name);}catch(e){evidence.cases.push({name,pass:false,durationMs:Date.now()-start,error:e.stack});console.log('FAIL',name,e.message);if(a){await a.raw('handle_dialog',{pageId:a.page,action:'dismiss'});await evaluate(a,'()=>{document.querySelector("#clean")?.click();return true;}').catch(()=>{});await a.raw('close_page',{pageId:a.page});a.page=(await a.json('open_page',{url})).pageId;}}await writeFile(out,JSON.stringify(evidence,null,2)+'\n');}
let a,b;
try{
 a=await peer();b=await peer();evidence.threads=[a.thread,b.thread];
 if(!process.argv.includes('--remaining'))for(const [label,action,expected] of [['Alert','accept','continued'],['Confirm','dismiss',false],['Confirm','accept',true],['Prompt','accept','输入的测试值'],['Prompt','dismiss',null]])await testcase(`${label} ${action}: actual dialog, explicit decision and other-thread isolation`,async()=>{
  const start=Date.now();const opened=await click(a,label);assert.ok(!opened.isError,text(opened));assert.ok(Date.now()-start<5000,'Dialog should interrupt input promptly');if(opened.isError)evidence.cases.push({name:label+' click return observation',observation:true,result:opened});
  const blocked=await a.raw('take_snapshot',{pageId:a.page});assert.match(text(blocked),/# Open dialog/);assert.equal(blocked.isError,true);assert.match(text(blocked),/dialog is open/i);
  const scriptStart=Date.now();const blockedScript=await a.raw('evaluate_script',{pageId:a.page,function:'()=>document.title'});assert.equal(blockedScript.isError,true);assert.match(text(blockedScript),/dialog is open/i);assert.ok(Date.now()-scriptStart<3000,'Existing dialog must reject evaluation promptly');
  const other=await evaluate(b,'()=>document.title');assert.equal(other,'CBW Dialog Fixture');
  const foreign=await b.raw('handle_dialog',{pageId:a.page,action:'accept'});assert.equal(foreign.isError,true);assert.match(text(foreign),/PAGE_NOT_OWNED/);
  await a.call('handle_dialog',{pageId:a.page,action,...(label==='Prompt'&&action==='accept'?{promptText:expected}:{})});const s=await state(a);assert.equal(s.events.at(-1).value,expected);return {opened:text(opened),blocked:text(blocked),value:s.events.at(-1).value};
 });
 for(const action of ['dismiss','accept'])await testcase(`dirty form reload button + beforeunload ${action}`,async()=>{
  await a.call('fill',{pageId:a.page,uid:await uid(a,'Draft'),value:'partial draft '+action});const before=await state(a);
  const start=Date.now();const opened=await click(a,'Reload form');assert.ok(!opened.isError,text(opened));assert.ok(Date.now()-start<5000);const pending=await a.raw('take_snapshot',{pageId:a.page});assert.match(text(pending),/beforeunload/);if(opened.isError)evidence.cases.push({name:'Reload button click return observation',observation:true,result:opened});
  await evaluate(b,'()=>document.title');await a.call('handle_dialog',{pageId:a.page,action});const after=await state(a);
  assert.ok(after.attempts>before.attempts);assert.equal(after.loads,action==='dismiss'?before.loads:before.loads+1);assert.equal(after.draft,action==='dismiss'?before.draft:'');return {opened:text(opened),before,after};
 });
 for(const action of ['dismiss','accept',undefined])await testcase(`navigate_page reload beforeunload ${action??'default'}`,async()=>{
  await a.call('fill',{pageId:a.page,uid:await uid(a,'Draft'),value:'navigation draft'});const before=await state(a);
  const start=Date.now();const r=await a.raw('navigate_page',{pageId:a.page,type:'reload',timeout:4000,...(action?{handleBeforeUnload:action}:{})});const after=await state(a);assert.ok(!r.isError,text(r));assert.doesNotMatch(text(r),/timeout|Unable to/i);assert.ok(Date.now()-start<3000);
  assert.ok(after.attempts>before.attempts);assert.equal(after.loads,action!=='accept'?before.loads:before.loads+1);assert.equal(after.draft,action!=='accept'?before.draft:'');return {toolIsError:!!r.isError,text:text(r),before,after};
 });
 for(const type of ['url','back','forward'])await testcase('navigate_page '+type+' cancellation preserves draft',async()=>{
  await a.call('navigate_page',{pageId:a.page,url:url+'?history=one',handleBeforeUnload:'accept'});
  await a.call('navigate_page',{pageId:a.page,url:url+'?history=two',handleBeforeUnload:'accept'});
  if(type==='forward')await a.call('navigate_page',{pageId:a.page,type:'back',handleBeforeUnload:'accept'});
  await a.call('fill',{pageId:a.page,uid:await uid(a,'Draft'),value:'history draft'});
  const before=await evaluate(a,'()=>({url:location.href,draft:document.querySelector("textarea").value})');const start=Date.now();
  const r=await a.call('navigate_page',{pageId:a.page,type,...(type==='url'?{url:url+'?cancelled'}:{}),timeout:4000});
  assert.match(text(r),/cancelled/);assert.doesNotMatch(text(r),/timeout|Unable to/i);assert.ok(Date.now()-start<3000);
  const after=await evaluate(a,'()=>({url:location.href,draft:document.querySelector("textarea").value})');assert.deepEqual(after,before);return {text:text(r),after};
 });
 await testcase('navigate_page real network failure returns error and page can recover',async()=>{
  const r=await a.raw('navigate_page',{pageId:a.page,url:url+'network-failure',handleBeforeUnload:'accept',timeout:4000});assert.equal(r.isError,true);assert.match(text(r),/ERR_EMPTY_RESPONSE|ERR_CONNECTION/i);
  await a.call('navigate_page',{pageId:a.page,url});assert.equal(await evaluate(a,'()=>document.title'),'CBW Dialog Fixture');return {text:text(r)};
 });
 for(const action of ['default','dismiss'])await testcase(`evaluate_script confirm dialogAction ${action}`,async()=>{
  const r=await evaluate(a,'()=>confirm("evaluate fixture?")',action==='default'?{}:{dialogAction:'dismiss'});assert.equal(r,action==='default');assert.doesNotMatch(text(await a.call('take_snapshot',{pageId:a.page})),/# Open dialog/);return {accepted:r};
 });
 await testcase('HTML dialog modal remains an ordinary DOM interaction',async()=>{await click(a,'HTML modal');const snapshot=text(await a.call('take_snapshot',{pageId:a.page}));assert.match(snapshot,/dialog/);await click(a,'Modal cancel');assert.equal((await state(a)).events.at(-1).value,false);return {snapshot};});
 await testcase('Windows path direct file input reaches loopback server with exact content',async()=>{
  const r=await a.raw('upload_file',{pageId:a.page,uid:await uid(a,'Direct file'),filePaths:[winFolder+'\\'+files[0].name]});assert.ok(!r.isError,text(r));const received=await settleUpload(a,'Submit direct file');assert.deepEqual(received.files,[{name:files[0].name,size:Buffer.byteLength(files[0].body),content:files[0].body}]);return {tool:text(r),received};
 });
 await testcase('custom upload button invokes chooser and sends exact content',async()=>{
  const r=await a.raw('upload_file',{pageId:a.page,uid:await uid(a,'Choose proxy file'),filePaths:[winFolder+'\\'+files[1].name]});assert.ok(!r.isError,text(r));const received=await settleUpload(a,'Submit proxy file');assert.equal(received.files[0].content,files[1].body);return {tool:text(r),received};
 });
 await testcase('multiple files upload preserves both names and contents',async()=>{
  const r=await a.raw('upload_file',{pageId:a.page,uid:await uid(a,'Multiple files'),filePaths:files.map(f=>winFolder+'\\'+f.name)});assert.ok(!r.isError,text(r));const received=await settleUpload(a,'Submit multiple files');assert.deepEqual(received.files.map(f=>f.content),files.map(f=>f.body));return {tool:text(r),received};
 });
 await testcase('WSL native file upload preserves content over Windows host path',async()=>{
  const r=await a.call('upload_file',{pageId:a.page,uid:await uid(a,'Direct file'),filePaths:[linuxFile]});const received=await settleUpload(a,'Submit direct file');assert.equal(received.files[0].content,'linux '+id);return {tool:text(r),received};
 });
 await testcase('WSL mount path upload reaches browser and receiver',async()=>{
  const r=await a.call('upload_file',{pageId:a.page,uid:await uid(a,'Direct file'),filePaths:[join(mountFolder,files[0].name)]});const received=await settleUpload(a,'Submit direct file');assert.equal(received.files[0].content,files[0].body);return {tool:text(r),received};
 });
 for(const [label,path] of [['outside workspace path','/etc/hosts'],['missing Windows path',winFolder+'\\nonexistent.txt']])await testcase(`${label}: rejects invalid upload instead of reporting success`,async()=>{
  const r=await a.raw('upload_file',{pageId:a.page,uid:await uid(a,'Direct file'),filePaths:[path]});const after=await state(a);
  // Record the actual receiver result even if the browser exposes an empty placeholder File.
  let received;if(!r.isError)received=await evaluate(a,'async()=>{const f=document.querySelector("#direct").files[0];try{return {content:await f.text()};}catch(e){return {readError:e.name,message:e.message};}}');
  evidence.cases.push({name:label+' observation',observation:true,result:{toolIsError:!!r.isError,text:text(r),files:after.files,received}});
  assert.equal(r.isError,true,'Tool claimed success for an unreadable browser-host path; inspect observation and upload receipt');return {text:text(r),after};
 });
 await testcase('upload_file on an unrelated button errors and subsequent tools recover',async()=>{
  const r=await a.raw('upload_file',{pageId:a.page,uid:await uid(a,'Ping'),filePaths:[winFolder+'\\'+files[0].name]});assert.equal(r.isError,true);const check=await evaluate(a,'()=>document.title');assert.equal(check,'CBW Dialog Fixture');await evaluate(b,'()=>document.title');return {text:text(r)};
 });
 for(const label of ['Open popup tab','Open popup'])await testcase(label+' is adopted only by the opener workspace',async()=>{
  const before=await a.json('list_pages'),known=new Set(before.pages.map(p=>p.pageId));
  const oldTargets=await ext.evaluate('async()=> (await chrome.debugger.getTargets()).map(t=>t.id)');
  await click(a,label);let listing;
  for(let n=0;n<20;n++){listing=await a.json('list_pages');if(listing.pages.length>before.pages.length)break;await new Promise(r=>setTimeout(r,100));}
  const candidates=await ext.evaluate(`async()=>{const targets=await chrome.debugger.getTargets();return targets.filter(t=>t.type==='page'&&!${JSON.stringify(oldTargets)}.includes(t.id)).map(t=>({targetId:t.id,tabId:t.tabId}));}`);
  for(const receipt of candidates)if(await openerTarget(config.browserURL,receipt.targetId)===a.page.split(':')[2])orphanReceipts.push(receipt);
  const popup=listing.pages.find(p=>!known.has(p.pageId));assert.ok(popup,'Popup must be registered');assert.match(popup.url,/\/popup/);
  const result=await a.call('take_snapshot',{pageId:popup.pageId});assert.match(text(result),/Fixture popup/);
  const other=await b.json('list_pages');assert.equal(other.pages.length,1);const forbidden=await b.raw('take_snapshot',{pageId:popup.pageId});assert.equal(forbidden.isError,true);await a.call('close_page',{pageId:popup.pageId});return {popup,foreignError:text(forbidden)};
 });
}catch(e){evidence.fatal=e.stack;console.error(e);}
finally{
 for(const p of peers){try{await p.raw('handle_dialog',{pageId:p.page,action:'dismiss'});await evaluate(p,'()=>{document.querySelector("#clean")?.click();return true;}');for(const page of (await p.json('list_pages')).pages)await p.call('close_page',{pageId:page.pageId});}catch(e){evidence.cleanupError=e.message;}await p.client.close();}
 if(orphanReceipts.length)try{await ext.evaluate(`async()=>{const targets=await chrome.debugger.getTargets();const receipts=${JSON.stringify(orphanReceipts)};for(const r of receipts)if(targets.some(t=>t.tabId===r.tabId&&t.id===r.targetId))await chrome.tabs.remove(r.tabId);return true;}`);}catch(e){evidence.popupCleanupError=e.message;}await ext.close();
 server.closeAllConnections();await new Promise(r=>server.close(r));await rm(mountFolder,{recursive:true,force:true});await rm(linuxFile,{force:true});evidence.fixtureFilesRemoved=true;
 evidence.summary={passed:evidence.cases.filter(c=>c.pass===true).length,failed:evidence.cases.filter(c=>c.pass===false).length,observations:evidence.cases.filter(c=>c.observation).length};
 await writeFile(out,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence.summary));if(evidence.fatal||evidence.cleanupError||evidence.summary.failed)process.exitCode=1;
}
