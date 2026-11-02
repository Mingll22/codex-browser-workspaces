import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {Rpc} from '../dist/adapter/src/rpc.js';
import {extensionTestClient} from '../scripts/extension-test-client.mjs';
const config=JSON.parse(await readFile('.artifacts/dev-config.json','utf8'));
const id=async n=>(await readFile(`.artifacts/acceptance-${n}-cli.jsonl`,'utf8')).trim().split('\n').map(JSON.parse).find(x=>x.type==='thread.started').thread_id;
const aId=await id('a'),bId=await id('b');
const meta=threadId=>({threadId,'x-codex-turn-metadata':{thread_id:threadId,codex_version:'0.162.1'}});
function connection(threadId){const rpc=new Rpc(config.socket);return {rpc,id:threadId,async call(name,args={}){const r=await rpc.call('call',{name,args,meta:meta(this.id)});if(r.isError)throw new Error(JSON.stringify(r));return r;},async json(name,args={}){return JSON.parse((await this.call(name,args)).content[0].text);}};}
let a=connection(aId),b=connection(bId),ext,child;
const evidence={layer:'real Chrome + adapter protocol',checks:[]};
const pass=name=>{evidence.checks.push(name);console.log('PASS',name);};
const root='http://127.0.0.1:19228';
try{
 for(const c of [a,b]){try{for(const p of (await c.json('list_pages')).pages)await c.call('close_page',{pageId:p.pageId});}catch(e){if(!e.message.includes('WORKSPACE_RESTORE_REQUIRED'))throw e;await c.call('reset_workspace',{acknowledgeLostPages:true});}}
 const pa=await a.json('open_page',{url:root+'/lifecycle-a'}),pb=await b.json('open_page',{url:root+'/lifecycle-b'});
 ext=await extensionTestClient(pa.pageId.split(':').at(-1));
 const receipt=await ext.evaluate(`async()=>{const targets=await chrome.debugger.getTargets();const a=targets.find(t=>t.id===${JSON.stringify(pa.pageId.split(':').at(-1))});const b=targets.find(t=>t.id===${JSON.stringify(pb.pageId.split(':').at(-1))});const tabs=await Promise.all([chrome.tabs.get(a.tabId),chrome.tabs.get(b.tabId)]);return {a:a.tabId,b:b.tabId,groupA:tabs[0].groupId,groupB:tabs[1].groupId,active:(await chrome.tabs.query({active:true,currentWindow:true})).map(t=>t.id),titles:await Promise.all(tabs.map(t=>chrome.tabGroups.get(t.groupId).then(g=>g.title)))}}`);
 assert.notEqual(receipt.groupA,receipt.groupB);assert.equal(receipt.titles[0],receipt.titles[1]);pass('same titles still produce distinct groups');
 await ext.evaluate(`async()=>{await chrome.tabs.ungroup(${receipt.a});return true}`);
 assert.equal((await a.json('list_pages')).pages.length,0);await assert.rejects(a.call('take_snapshot',{pageId:pa.pageId}),/PAGE_NOT_OWNED/);
 await ext.evaluate(`async()=>{await chrome.tabs.group({tabIds:${receipt.a},groupId:${receipt.groupB}});return true}`);
 assert.equal((await b.json('list_pages')).pages.length,1);await assert.rejects(b.call('take_snapshot',{pageId:pa.pageId}),/PAGE_NOT_OWNED/);pass('moving out revokes access; moving into another workspace never transfers ownership');
 // Cleanup only the exact tab moved by this test, checked against its original target receipt.
 await ext.evaluate(`async()=>{const t=(await chrome.debugger.getTargets()).find(t=>t.id===${JSON.stringify(pa.pageId.split(':').at(-1))});if(t?.tabId!==${receipt.a})throw Error('TEST_TARGET_CHANGED');await chrome.tabs.remove(t.tabId);return true}`);
 await ext.close();ext=undefined;
 const reopened=await a.json('open_page',{url:root+'/lifecycle-resume'});
 await a.call('set_page_retention',{pageId:reopened.pageId,retained:true});
 await a.call('open_page',{url:root+'/ttl-disposable',slot:'disposable'});
 await a.call('evaluate_script',{pageId:reopened.pageId,function:'()=>{document.querySelector("#draft").value="persist across broker restart";return true}',waitForStableDom:false});
 const before=(await a.json('list_pages')).pages.map(p=>p.pageId).sort();
 const pid=Number(process.env.CBW_TEST_BROKER_PID);if(!Number.isInteger(pid)||pid<=1)throw new Error('CBW_TEST_BROKER_PID required');
 const command=await readFile(`/proc/${pid}/cmdline`,'utf8');assert.ok(command.includes('dist/adapter/src/broker.js')&&command.includes('.artifacts/dev-config.json'));
 a.rpc.close();b.rpc.close();process.kill(pid,'SIGTERM');
 for(let i=0;i<50;i++){try{process.kill(pid,0);}catch{break;}await new Promise(r=>setTimeout(r,100));}
 const ttl={...config,detachedTtlMs:2000};await writeFile('.artifacts/ttl-config.json',JSON.stringify(ttl),{mode:0o600});
 child=spawn(process.execPath,['dist/adapter/src/broker.js','.artifacts/ttl-config.json'],{stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('BROKER_START_TIMEOUT')),15000);child.stdout.on('data',chunk=>{if(chunk.toString().includes('broker ready')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(new Error('Broker exited '+code));});});
 for(let i=0;i<50;i++){if((await (await fetch(config.pairing.url.replace('ws:','http:')+'/health')).json()).connected)break;await new Promise(r=>setTimeout(r,100));}
 a=connection(aId);b=connection(bId);
 assert.deepEqual((await a.json('list_pages')).pages.map(p=>p.pageId).sort(),before);
 await b.json('list_pages');
 const draft=await a.call('evaluate_script',{pageId:reopened.pageId,function:'()=>document.querySelector("#draft").value',waitForStableDom:false});assert.match(draft.content[0].text,/persist across broker restart/);pass('broker restart + extension reconnect preserve exact tabs and form state');
 await new Promise(r=>setTimeout(r,4500));assert.equal((await a.json('list_pages')).pages.length,2);assert.equal((await b.json('list_pages')).pages.length,1);pass('active controllers survive short TTL without browser calls');
 a.rpc.close();await new Promise(r=>setTimeout(r,4500));a=connection(aId);
 const after=(await a.json('list_pages')).pages;assert.equal(after.length,1);assert.equal(after[0].pageId,reopened.pageId);assert.equal(after[0].retained,true);assert.equal((await b.json('list_pages')).pages.length,1);pass('detached TTL only closes own non-retained tabs');
 b.rpc.close();await new Promise(r=>setTimeout(r,100));a.id=bId;assert.equal((await a.json('list_pages')).pages[0].pageId,pb.pageId);const old=connection(aId);assert.equal((await old.json('list_pages')).pages[0].pageId,reopened.pageId);old.rpc.close();pass('same stdio connection identity switch releases previous controller');
 a.id=aId;
}catch(e){evidence.failure=e.message;console.error(e);process.exitCode=1;}
finally{
 await ext?.close();a.rpc.close();b.rpc.close();await new Promise(r=>setTimeout(r,100));
 for(const thread of [aId,bId]){const c=connection(thread);try{for(const p of (await c.json('list_pages')).pages)await c.call('close_page',{pageId:p.pageId});}catch(e){evidence.cleanupError=e.message;}finally{c.rpc.close();}}
 if(child){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
 await writeFile('.artifacts/lifecycle-results.json',JSON.stringify(evidence,null,2)+'\n');
}
