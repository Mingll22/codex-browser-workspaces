// Opt-in 0.4 host integration; requires the matching installed candidate.
// Creates dedicated persisted threads for authoritative family lookup, then
// archives those exact threads through the official host API. No model turn.
// Only positively owned disposable fixture pages are mutated.
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
const expectedExtension=JSON.parse(await readFile(new URL('../packages/extension/manifest.json',import.meta.url),'utf8')).version;
assert.match(expectedVersion,/^0\.4\./,'This harness targets the 0.4 root-family/lease contract');
assert.ok(health.connected&&health.adapter===expectedVersion&&health.extension===expectedExtension,'Install and connect the matching candidate before running this fixture');
assert.equal(config.closedThreadGraceMs??30000,30000,'This harness checks the default 30-second process-exit grace');
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
const evidence={layer:'real Codex app-server lifecycle + matching 0.4 adapter + real Chrome; no model turns',checks:[],fixtureThreads:[],fixtureControllerPid:process.pid};
const pass=name=>{evidence.checks.push(name);console.log('PASS',name);};
const ledger=async()=>JSON.parse(await readFile(config.stateDir+'/workspaces.json','utf8'));
async function tool(threadId,name,args={}){
 // The experimental host API injects threadId itself. It does not add the
 // turn-metadata envelope, which this fixture supplies for the actual thread.
 const r=await request('mcpServer/tool/call',{threadId,server:'cbw_cleanup_fixture',tool:name,arguments:args,_meta:{'x-codex-turn-metadata':{thread_id:threadId}}});
 if(r.isError)throw Error(JSON.stringify(r));return JSON.parse(r.content[0].text);
}
async function start(){
 const r=await request('thread/start',{ephemeral:false,cwd:root,approvalPolicy:'never'}),id=r.thread.id;evidence.fixtureThreads.push(id);
 await request('thread/name/set',{threadId:id,name:'CBW lifecycle fixture'});
 await request('thread/inject_items',{threadId:id,items:[{type:'message',role:'user',content:[{type:'input_text',text:'Disposable browser lifecycle fixture. No model turn is requested.'}]}]});
 // Official history writes persist this no-turn fixture; gate on broker visibility. Never create
 // a database row or claim a missing ancestry edge ourselves.
 await until(async()=>{try{await tool(id,'list_pages');return true;}catch(error){if(error.message.includes('THREAD_FAMILY_NOT_READY'))return false;throw error;}},15000,'PERSISTED_FIXTURE_THREAD_NOT_READY');
 return id;
}
async function until(check,timeout=55000,label='FIXTURE_CONDITION_TIMEOUT'){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await pause(500);}throw Error(label);}
const receipts=[],manualRpcs=[];let ext;
evidence.receipts=receipts;
const targetOf=page=>page.pageId.split(':')[2];
async function receipt(page){
 const targetId=targetOf(page);
 const r=await ext.evaluate(`async()=>{const target=(await chrome.debugger.getTargets()).find(t=>t.id===${JSON.stringify(targetId)});if(!target)throw Error('FIXTURE_TARGET_MISSING');const tab=await chrome.tabs.get(target.tabId),group=await chrome.tabGroups.get(tab.groupId);return {targetId:target.id,tabId:tab.id,groupId:tab.groupId,windowId:tab.windowId,title:group.title};}`);
 receipts.push(r);return r;
}
async function present(r){return ext.evaluate(`async()=>({tab:(await chrome.debugger.getTargets()).some(t=>t.id===${JSON.stringify(r.targetId)}&&t.tabId===${r.tabId}),group:(await chrome.tabGroups.query({})).some(g=>g.id===${r.groupId})})`);}
try{
 ext=await extensionTestClient(anchor);
 await request('initialize',{clientInfo:{name:'cbw-cleanup-fixture',version:'1.0'},capabilities:{experimentalApi:true}});
 child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
 const a=await start(),b=await start(),c=await start();
 const pa=await tool(a,'open_page',{url:'about:blank'}),ra=await receipt(pa);
 const pb=await tool(b,'open_page',{url:'about:blank'}),rb=await receipt(pb);
 const pc=await tool(c,'open_page',{url:'about:blank'}),rc=await receipt(pc);
 await tool(c,'set_page_retention',{pageId:pc.pageId,retained:true});
 const disposable=await tool(c,'open_page',{url:'about:blank',slot:'disposable'}),rd=await receipt(disposable);
 if(process.env.CBW_EXPECTED_PROJECT){for(const r of [ra,rb,rc])assert.ok(r.title.startsWith('['+process.env.CBW_EXPECTED_PROJECT+']'));pass('actual fixture groups display the expected project prefix');}
 // Simulate the user inserting this exact disposable external tab into C's group.
 const externalReceipt=await ext.evaluate(`async()=>{const tab=await chrome.tabs.create({windowId:${rc.windowId},active:false,url:'about:blank'});await chrome.tabs.group({tabIds:tab.id,groupId:${rc.groupId}});return {tabId:tab.id,groupId:${rc.groupId},windowId:tab.windowId};}`);
 receipts.push(externalReceipt);
 await until(async()=>{const targetId=await ext.evaluate(`async()=> (await chrome.debugger.getTargets()).find(t=>t.tabId===${externalReceipt.tabId}&&t.type==='page')?.id??null`);if(!targetId)return false;externalReceipt.targetId=targetId;return true;},10000,'EXTERNAL_FIXTURE_TARGET_NOT_DISCOVERED');
 const external=(await tool(c,'list_pages')).pages.find(page=>targetOf(page)===externalReceipt.targetId);
 assert.ok(external);assert.equal(external.source,'external');assert.equal(external.canClose,false);
 await assert.rejects(tool(c,'close_page',{pageId:external.pageId}),/PAGE_CLOSE_PROTECTED/);
 await tool(c,'release_page',{pageId:external.pageId});
 const initial=(await ledger()).actors;
 for(const id of [a,b,c]){assert.equal(initial[id].root,id);assert.ok(initial[id].owner);}
 assert.notEqual(initial[a].owner.pid,initial[b].owner.pid);
 evidence.processes={a:initial[a].owner,b:initial[b].owner,c:initial[c].owner};
 pass('real persisted fixture roots register separate host MCP subprocesses');
 await pause(37000);assert.equal((await present(ra)).tab,true);assert.equal((await present(rb)).tab,true);
 pass('idle loaded threads keep their groups beyond cleanup grace without browser calls');
 // Recent operations hold a five-minute lease. Release it so this fixture
 // measures the 30-second close grace independently from lease expiry.
 for(const [threadId,page] of [[a,pa],[c,pc],[c,disposable]])await tool(threadId,'release_page',{pageId:page.pageId});
 for(const page of (await tool(c,'list_pages')).pages)assert.equal(page.lease.status,'AVAILABLE');
 await request('thread/unsubscribe',{threadId:a});await request('thread/unsubscribe',{threadId:c});
 await until(()=>controllerExited(initial[a].owner)&&controllerExited(initial[c].owner),15000);
 pass('Codex unsubscribe/unload terminates the corresponding MCP subprocesses');
 await until(async()=>!(await present(ra)).tab);
 assert.deepEqual(await present(ra),{tab:false,group:false});assert.deepEqual(await present(rb),{tab:true,group:true});
 await until(async()=>!(await present(rd)).tab);
 assert.deepEqual(await present(rc),{tab:true,group:true});assert.equal((await present(rd)).tab,false);
 assert.equal((await present(externalReceipt)).tab,true);assert.equal(controllerExited(initial[b].owner),false);
 pass('released disposable pages close while retained, independently protected external and another live root survive');
 // A fourth real persisted fixture ID replaces the old synthetic identity.
 // End its host controller before testing the harness-owned raw RPC lifetime.
 const id=await start(),hostOwner=(await ledger()).actors[id].owner;evidence.processes.d=hostOwner;
 await request('thread/unsubscribe',{threadId:id});await until(()=>controllerExited(hostOwner),15000);
 const meta={threadId:id,'x-codex-turn-metadata':{thread_id:id}};evidence.reconnectFixtureThread=id;
 const owner=new Rpc(config.socket);manualRpcs.push(owner);await owner.call('hello',{cwd:root});
 const r=await owner.call('call',{name:'open_page',args:{url:'about:blank'},meta});const reconnectPage=JSON.parse(r.content[0].text);
 const rm=await receipt(reconnectPage);owner.close();
 await pause(37000);assert.equal((await present(rm)).tab,true);
 const replacement=new Rpc(config.socket);manualRpcs.push(replacement);await replacement.call('hello',{cwd:root});
 const resumed=JSON.parse((await replacement.call('call',{name:'list_pages',args:{},meta})).content[0].text);assert.equal(resumed.pages[0].pageId,reconnectPage.pageId);replacement.close();
 pass('disconnected live harness controller preserves the exact page and reconnects using a registered fixture root');
 evidence.notifications=notifications.filter(m=>['thread/closed','thread/status/changed'].includes(m.method));
 evidence.receipts=receipts;evidence.success=true;
}catch(error){evidence.error=error.stack;console.error(error);process.exitCode=1;}
finally{
 for(const rpc of manualRpcs)rpc.close();
 if(child.exitCode===null&&child.signalCode===null){
  for(const id of evidence.fixtureThreads)try{await request('thread/unsubscribe',{threadId:id});}catch(error){(evidence.cleanupErrors??=[]).push(error.message);}
  try{await until(()=>Object.values(evidence.processes??{}).every(controllerExited),15000);}catch(error){(evidence.cleanupErrors??=[]).push(error.message);}
 }
 // Exact fixture tab/target receipts, never URL/title scans. Simulate explicit
 // user close; protected/retained fixture tabs never go through adapter close.
 if(ext){
  for(const r of receipts)try{assert.match(r.targetId??'',/^[A-F0-9]{32}$/,'FIXTURE_TARGET_RECEIPT_MISSING');await ext.evaluate(`async()=>{const target=(await chrome.debugger.getTargets()).find(t=>t.id===${JSON.stringify(r.targetId)});if(!target)return true;if(target.tabId!==${r.tabId})throw Error('FIXTURE_TARGET_CHANGED');await chrome.tabs.remove(target.tabId);return true;}`);}catch(error){(evidence.cleanupErrors??=[]).push(error.message);process.exitCode=1;}
 }
 if(child.exitCode===null&&child.signalCode===null){
  evidence.archivedFixtureThreads=[];
  for(const id of evidence.fixtureThreads)try{await request('thread/archive',{threadId:id});evidence.archivedFixtureThreads.push(id);}catch(error){(evidence.cleanupErrors??=[]).push('Archive '+id+': '+error.message);process.exitCode=1;}
 }
 if(ext)for(const r of receipts)try{assert.equal((await present(r)).tab,false);}catch(error){(evidence.cleanupErrors??=[]).push(error.message);process.exitCode=1;}
 await ext?.close();child.kill('SIGTERM');await pause(200);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');lines.close();
 if(evidence.cleanupErrors?.length){evidence.success=false;process.exitCode=1;}
 if(!evidence.success)await writeFile(outputPath+'.stderr.log',stderr,{mode:0o600});
 await writeFile(outputPath,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
}
