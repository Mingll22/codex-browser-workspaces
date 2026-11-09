// Opt-in: real Codex app-server threads + installed broker + shared Chrome.
// No model turn is started. Only this harness's disposable pages are mutated.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {extensionTestClient} from '../scripts/extension-test-client.mjs';
import {Rpc} from '../dist/adapter/src/rpc.js';
import {controllerExited} from '../dist/adapter/src/controller-process.js';

const [anchor,configPath,outputPath]=process.argv.slice(2);
assert.match(anchor??'',/^[A-F0-9]{32}$/);assert.ok(configPath&&outputPath,'Pass owned anchor, installed config and output JSON');
const config=JSON.parse(await readFile(configPath,'utf8'));
const health=await (await fetch(config.pairing.url.replace('ws:','http:')+'/health')).json();
const expectedVersion=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
assert.ok(health.connected&&health.adapter===expectedVersion,'Install and connect the matching adapter candidate before running this fixture');
const root=fileURLToPath(new URL('../',import.meta.url));
assert.ok(process.env.CBW_INSTALLED_DIST,'Set CBW_INSTALLED_DIST to the installed dist directory');
const installed=fileURLToPath(new URL('adapter/src/stdio.js',new URL('file://'+process.env.CBW_INSTALLED_DIST+'/')));
const mcp=`{cbw_cleanup_fixture={command=${JSON.stringify(process.execPath)},args=${JSON.stringify([installed,configPath])},default_tools_approval_mode="approve"}}`;
const env={...process.env};delete env.CODEX_THREAD_ID;delete env.CODEX_SESSION_ID;
const child=spawn('codex',['app-server','--stdio','-c','thread_unload_delay_secs=1','-c',`mcp_servers=${mcp}`],{cwd:root,env,stdio:['pipe','pipe','pipe']});
const pending=new Map();let next=0,stderr='';const notifications=[];
child.stderr.on('data',chunk=>stderr+=chunk);
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{const m=JSON.parse(line);if(m.id!==undefined){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}else notifications.push(m);});
child.on('exit',code=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('APP_SERVER_EXITED '+code));}pending.clear();});
function request(method,params={}){return new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error('APP_SERVER_TIMEOUT '+method));},60000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evidence={layer:'real Codex 0.166.0 app-server lifecycle + installed adapter + real Chrome; no model calls',checks:[],fixtureThreads:[],fixtureControllerPid:process.pid};
const pass=name=>{evidence.checks.push(name);console.log('PASS',name);};
const records=async()=>JSON.parse(await readFile(config.stateDir+'/workspaces.json','utf8')).workspaces;
async function tool(threadId,name,args={}){
 // The experimental host API injects threadId itself. It does not add the
 // turn-metadata envelope, which this fixture supplies for the actual thread.
 const r=await request('mcpServer/tool/call',{threadId,server:'cbw_cleanup_fixture',tool:name,arguments:args,_meta:{'x-codex-turn-metadata':{thread_id:threadId}}});
 if(r.isError)throw Error(JSON.stringify(r));return JSON.parse(r.content[0].text);
}
async function start(){const r=await request('thread/start',{ephemeral:true,cwd:root,approvalPolicy:'never'});evidence.fixtureThreads.push(r.thread.id);return r.thread.id;}
async function until(check,timeout=55000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await pause(500);}throw Error('FIXTURE_CONDITION_TIMEOUT');}
const receipts=[];let ext;
async function receipt(page){
 const targetId=page.pageId.split(':').at(-1);
 const r=await ext.evaluate(`async()=>{const target=(await chrome.debugger.getTargets()).find(t=>t.id===${JSON.stringify(targetId)});if(!target)throw Error('FIXTURE_TARGET_MISSING');const tab=await chrome.tabs.get(target.tabId),group=await chrome.tabGroups.get(tab.groupId);return {targetId:target.id,tabId:tab.id,groupId:tab.groupId,windowId:tab.windowId,title:group.title};}`);
 receipts.push(r);return r;
}
async function present(r){return ext.evaluate(`async()=>({tab:(await chrome.debugger.getTargets()).some(t=>t.id===${JSON.stringify(r.targetId)}&&t.tabId===${r.tabId}),group:(await chrome.tabGroups.query({})).some(g=>g.id===${r.groupId})})`);}
let manual;
try{
 ext=await extensionTestClient(anchor);
 await request('initialize',{clientInfo:{name:'cbw-cleanup-fixture',version:'1.0'},capabilities:{experimentalApi:true}});
 child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
 const a=await start(),b=await start(),c=await start();
 const pa=await tool(a,'open_page',{url:'about:blank'}),pb=await tool(b,'open_page',{url:'about:blank'});
 const pc=await tool(c,'open_page',{url:'about:blank'});await tool(c,'set_page_retention',{pageId:pc.pageId,retained:true});
 const disposable=await tool(c,'open_page',{url:'about:blank',slot:'disposable'});
 const ra=await receipt(pa),rb=await receipt(pb),rc=await receipt(pc),rd=await receipt(disposable);
 if(process.env.CBW_EXPECTED_PROJECT){for(const [r,id] of [[ra,a],[rb,b],[rc,c]])assert.equal(r.title,`[${process.env.CBW_EXPECTED_PROJECT}]Codex ${id.slice(0,8)}`);pass('actual Chrome groups display project prefix using unpersisted thread context');}
 const initial=await records();assert.ok(initial[a].owner);assert.ok(initial[b].owner);assert.notEqual(initial[a].owner.pid,initial[b].owner.pid);
 evidence.processes={a:initial[a].owner,b:initial[b].owner,c:initial[c].owner};
 pass('real per-thread MCP processes registered using actual Codex-generated thread IDs');
 await pause(37000);assert.equal((await present(ra)).tab,true);assert.equal((await present(rb)).tab,true);
 pass('idle loaded threads keep their groups beyond cleanup grace without browser calls');
 await request('thread/unsubscribe',{threadId:a});await request('thread/unsubscribe',{threadId:c});
 await until(()=>controllerExited(initial[a].owner)&&controllerExited(initial[c].owner),15000);
 pass('Codex unsubscribe/unload terminates the corresponding MCP subprocesses');
 await until(async()=>!(await records())[a]);
 assert.deepEqual(await present(ra),{tab:false,group:false});assert.deepEqual(await present(rb),{tab:true,group:true});
 await until(async()=>(await records())[c]?.cleanupDone===true);
 assert.deepEqual(await present(rc),{tab:true,group:true});assert.equal((await present(rd)).tab,false);
 assert.equal(controllerExited(initial[b].owner),false);
 pass('closed thread group disappears automatically; another live thread and retained page survive');
 const id=crypto.randomUUID(),meta={threadId:id,'x-codex-turn-metadata':{thread_id:id}};evidence.syntheticThread=id;
 const owner=new Rpc(config.socket);await owner.call('hello',{cwd:root});
 const r=await owner.call('call',{name:'open_page',args:{url:'about:blank'},meta});const reconnectPage=JSON.parse(r.content[0].text);manual={id,meta,page:reconnectPage};
 const rm=await receipt(reconnectPage);owner.close();
 await pause(37000);assert.equal((await present(rm)).tab,true);
 const replacement=new Rpc(config.socket);await replacement.call('hello',{cwd:root});
 const resumed=JSON.parse((await replacement.call('call',{name:'list_pages',args:{},meta})).content[0].text);assert.equal(resumed.pages[0].pageId,reconnectPage.pageId);replacement.close();
 pass('transport disconnect with live controller preserves exact page and permits reconnect');
 evidence.notifications=notifications.filter(m=>['thread/closed','thread/status/changed'].includes(m.method));
 evidence.receipts=receipts;evidence.success=true;
}catch(error){evidence.error=error.stack;console.error(error);process.exitCode=1;}
finally{
 if(child.exitCode===null&&child.signalCode===null){
  for(const id of evidence.fixtureThreads)try{await request('thread/unsubscribe',{threadId:id});}catch(error){(evidence.cleanupErrors??=[]).push(error.message);}
  try{await until(()=>Object.values(evidence.processes??{}).every(controllerExited),15000);}catch(error){(evidence.cleanupErrors??=[]).push(error.message);}
 }
 // Exact receipts, never URL/title scans. Retained fixture pages are explicitly
 // closed here because their only purpose was this test.
 if(ext){
  for(const r of receipts)try{await ext.evaluate(`async()=>{const target=(await chrome.debugger.getTargets()).find(t=>t.id===${JSON.stringify(r.targetId)});if(!target)return true;if(target.tabId!==${r.tabId})throw Error('FIXTURE_TARGET_CHANGED');await chrome.tabs.remove(target.tabId);return true;}`);}catch(error){(evidence.cleanupErrors??=[]).push(error.message);process.exitCode=1;}
 }
 for(const id of [...evidence.fixtureThreads,...(manual?[manual.id]:[])]){
  if(!(await records())[id])continue;
  const rpc=new Rpc(config.socket);try{await rpc.call('hello',{cwd:root});const meta={threadId:id,'x-codex-turn-metadata':{thread_id:id}};let pages=JSON.parse((await rpc.call('call',{name:'list_pages',args:{},meta})).content[0].text).pages;for(const page of pages)await rpc.call('call',{name:'close_page',args:{pageId:page.pageId},meta});pages=JSON.parse((await rpc.call('call',{name:'list_pages',args:{},meta})).content[0].text).pages;assert.equal(pages.length,0);}catch(error){(evidence.cleanupErrors??=[]).push(error.message);process.exitCode=1;}finally{rpc.close();}
 }
 if(ext)for(const r of receipts)try{assert.equal((await present(r)).tab,false);}catch(error){(evidence.cleanupErrors??=[]).push(error.message);process.exitCode=1;}
 await ext?.close();child.kill('SIGTERM');await pause(200);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');lines.close();
 if(!evidence.success)await writeFile(outputPath+'.stderr.log',stderr,{mode:0o600});
 await writeFile(outputPath,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
}
