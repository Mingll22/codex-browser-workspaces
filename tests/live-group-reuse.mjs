// Explicit real-Chrome integration using synthetic, disposable protocol identities.
// All browser operations go through the official Chrome DevTools MCP, including
// fixture lifecycle in our own extension worker. Never use an existing thread ID.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {Rpc} from '../dist/adapter/src/rpc.js';
import {extensionTestClient} from '../scripts/extension-test-client.mjs';

const [anchor,configPath,outputPath]=process.argv.slice(2);
assert.match(anchor??'',/^[A-F0-9]{32}$/);
assert.ok(configPath&&outputPath,'Pass owned anchor target, broker config and output JSON path');
const config=JSON.parse(await readFile(configPath,'utf8'));
const evidence={layer:'real Chrome + installed broker; synthetic fixture thread IDs, not new CLI sessions',checks:[]};
const pass=name=>{evidence.checks.push(name);console.log('PASS',name);};
function connection(){
 const id=randomUUID(),rpc=new Rpc(config.socket);
 const ready=rpc.call('hello',{cwd:process.cwd(),version:'fixture'});
 const meta={threadId:id,'x-codex-turn-metadata':{thread_id:id,codex_version:'fixture'}};
 return {id,rpc,async call(name,args={}){await ready;const r=await rpc.call('call',{name,args,meta});if(r.isError)throw Error(JSON.stringify(r));return r;},async json(name,args={}){return JSON.parse((await this.call(name,args)).content[0].text);}};
}
const a=connection(),b=connection();
evidence.fixtureThreads=[a.id,b.id];
let ext;
const receipts=[];
const fixtureURL=config.pairing.url.replace('ws:','http:')+'/health';
const targetOf=p=>p.pageId.split(':').at(-1);
async function receipt(page){
 const r=await ext.evaluate(`async()=>{
 const target=(await chrome.debugger.getTargets()).find(t=>t.id===${JSON.stringify(targetOf(page))});
 if(!target)throw Error('FIXTURE_TARGET_MISSING');
 const t=await chrome.tabs.get(target.tabId);return {tabId:t.id,targetId:target.id,groupId:t.groupId,windowId:t.windowId};}`);
 receipts.push(r);return r;
}
async function move(r,groupId){
 return ext.evaluate(`async()=>{
 const target=(await chrome.debugger.getTargets()).find(t=>t.id===${JSON.stringify(r.targetId)});
 if(target?.tabId!==${r.tabId})throw Error('FIXTURE_TARGET_CHANGED');
 ${groupId===-1?`await chrome.tabs.ungroup(${r.tabId})`:`await chrome.tabs.group({tabIds:${r.tabId},groupId:${groupId}})`};return true;}`);
}
async function remove(r){
 return ext.evaluate(`async()=>{
 const target=(await chrome.debugger.getTargets()).find(t=>t.id===${JSON.stringify(r.targetId)});
 if(!target)return {alreadyGone:true};
 if(target.tabId!==${r.tabId})throw Error('FIXTURE_TARGET_CHANGED');
 await chrome.tabs.remove(target.tabId);return {removed:true};}`);
}
try{
 ext=await extensionTestClient(anchor);
 const pa=await a.json('open_page',{url:fixtureURL}),pb=await b.json('open_page',{url:fixtureURL});
 const ra=await receipt(pa),rb=await receipt(pb);
 const color=await ext.evaluate(`async()=> (await chrome.tabGroups.get(${ra.groupId})).color`);
 const ordinary=await ext.evaluate(`async()=>{
 const t=await chrome.tabs.create({windowId:${ra.windowId},active:false,url:'data:text/html,<title>CBW ordinary fixture</title><p>Temporary group lifecycle test</p>'});
 const target=(await chrome.debugger.getTargets()).find(x=>x.tabId===t.id);
 if(!target)throw Error('FIXTURE_TARGET_MISSING');return {tabId:t.id,targetId:target.id,windowId:t.windowId,groupId:t.groupId};}`);
 receipts.push(ordinary);
 await move(ordinary,ra.groupId);
 assert.equal((await a.json('list_pages')).pages.length,1);
 await move(ordinary,-1);
 const reuse=await a.json('open_page',{url:fixtureURL});assert.equal(reuse.reused,true);assert.equal(reuse.pageId,pa.pageId);
 pass('ordinary fixture enters/leaves without replacing owned page');
 await move(ordinary,ra.groupId);
 await move(ra,-1);
 assert.equal((await a.json('list_pages')).pages.length,0);
 await assert.rejects(a.call('evaluate_script',{pageId:pa.pageId,function:'()=>true'}),/PAGE_NOT_OWNED/);
 const next=await a.json('open_page',{url:fixtureURL});const rn=await receipt(next);
 assert.equal(rn.groupId,ra.groupId);assert.notEqual(next.pageId,pa.pageId);
 assert.equal(await ext.evaluate(`async()=> (await chrome.tabGroups.get(${ra.groupId})).color`),color);
 pass('empty ownership reuses surviving exact group and color');
 const ordinaryPageId=pa.pageId.slice(0,pa.pageId.lastIndexOf(':')+1)+ordinary.targetId;
 await assert.rejects(a.call('evaluate_script',{pageId:ordinaryPageId,function:'()=>true'}),/PAGE_NOT_OWNED/);
 await assert.rejects(b.call('evaluate_script',{pageId:next.pageId,function:'()=>true'}),/PAGE_NOT_OWNED/);
 assert.equal((await b.json('list_pages')).pages[0].pageId,pb.pageId);
 pass('ordinary tabs, revoked page and other thread remain inaccessible');
 await move(ra,ra.groupId);
 await assert.rejects(a.call('evaluate_script',{pageId:pa.pageId,function:'()=>true'}),/PAGE_NOT_OWNED/);
 await move(ra,-1);
 pass('confirmed revocation is not undone by manually rejoining');
 await a.call('close_page',{pageId:next.pageId});
 const afterClose=await a.json('open_page',{url:fixtureURL});const rc=await receipt(afterClose);
 assert.equal(rc.groupId,ra.groupId);
 pass('closing last owned tab preserves and reuses group containing ordinary fixture');
 await remove(ordinary);await remove(ra);
 await a.call('close_page',{pageId:afterClose.pageId});
 assert.equal(await ext.evaluate(`async()=> (await chrome.tabGroups.query({})).some(g=>g.id===${ra.groupId})`),false);
 const rebuilt=await a.json('open_page',{url:fixtureURL});const rr=await receipt(rebuilt);
 assert.notEqual(rr.groupId,ra.groupId);assert.notEqual(rr.groupId,rb.groupId);
 pass('actually deleted group is recreated without adopting another thread group');
 const result=await a.call('evaluate_script',{pageId:rebuilt.pageId,function:'()=>JSON.parse(document.body.innerText).connected',waitForStableDom:false});
 assert.match(result.content[0].text,/true/);pass('new page remains usable through official MCP');
 evidence.receipts=receipts;
}catch(error){evidence.failure=error.stack;console.error(error);process.exitCode=1;}
finally{
 for(const c of [a,b]){
  try{for(const p of (await c.json('list_pages')).pages)await c.call('close_page',{pageId:p.pageId});}
  catch(e){(evidence.cleanupErrors??=[]).push(e.message);process.exitCode=1;}
  c.rpc.close();
 }
 if(ext){
  for(const r of receipts)try{await remove(r);}catch(e){(evidence.cleanupErrors??=[]).push(e.message);process.exitCode=1;}
  await ext.close();
 }
 await writeFile(outputPath,JSON.stringify(evidence,null,2)+'\n');
}
