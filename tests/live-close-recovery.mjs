import {join} from 'node:path';
import {homedir} from 'node:os';
// Real browser, one unchanged stdio MCP connection, disposable synthetic identity.
// All browser actions use official Chrome DevTools MCP, including closing the
// exact fixture tabs through our extension. No existing thread is impersonated.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {extensionTestClient} from '../scripts/extension-test-client.mjs';
// HISTORICAL 0.3.x synthetic-identity harness; not 0.4 acceptance evidence.

const [anchor,configPath,outputPath]=process.argv.slice(2);
assert.match(anchor??'',/^[A-F0-9]{32}$/);assert.ok(configPath&&outputPath);
const config=JSON.parse(await readFile(configPath,'utf8'));
const baseline=await (await fetch(config.pairing.url.replace('ws:','http:')+'/health')).json();
assert.match(baseline.adapter??'',/^0\.3\./,'HISTORICAL_FIXTURE: synthetic close-recovery identities cannot run on 0.4; use its acceptance matrix');
const thread=randomUUID(),meta={threadId:thread,'x-codex-turn-metadata':{thread_id:thread,codex_version:'fixture'}};
const evidence={layer:'real Chrome + installed stdio MCP; synthetic disposable thread identity',thread,checks:[],connectionRestarts:0};
const client=new Client({name:'cbw-close-recovery-fixture',version:'0.1.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[join(process.env.XDG_DATA_HOME??join(homedir(),'.local/share'),'codex-browser-workspaces/dist/adapter/src/stdio.js'),configPath],stderr:'pipe'});
transport.stderr?.on('data',()=>{});
await client.connect(transport);
const raw=(name,args={})=>client.callTool({name,arguments:args,_meta:meta},undefined,{timeout:45000});
const call=async(name,args={})=>{const r=await raw(name,args);if(r.isError)throw Error(r.content.map(x=>x.text??'').join('\n'));return r;};
const json=async(name,args={})=>JSON.parse((await call(name,args)).content[0].text);
const pass=name=>{evidence.checks.push(name);console.log('PASS',name);};
const url=config.pairing.url.replace('ws:','http:')+'/health';
let ext,pending;
try{
 ext=await extensionTestClient(anchor);
 const a=await json('open_page',{url,slot:'main'}),b=await json('open_page',{url,slot:'reference'});
 const targetIds=[a,b].map(x=>x.pageId.split(':')[2]);
 const receipts=await ext.evaluate(`async()=>{const targets=await chrome.debugger.getTargets();return Promise.all(${JSON.stringify(targetIds)}.map(async id=>{const t=targets.find(x=>x.id===id);if(!t)throw Error('FIXTURE_TARGET_MISSING');const tab=await chrome.tabs.get(t.tabId);return {targetId:id,tabId:tab.id,groupId:tab.groupId,windowId:tab.windowId};}));}`);
 assert.equal(receipts[0].groupId,receipts[1].groupId);evidence.receipts=receipts;
 const marker='CBW_INFLIGHT_'+randomUUID();
 const started=performance.now();
 pending=raw('evaluate_script',{pageId:a.pageId,function:`()=>{document.title=${JSON.stringify(marker)};return new Promise(resolve=>setTimeout(()=>resolve('unexpected normal completion'),15000));}`,waitForStableDom:false}).then(result=>({result,finishedAt:performance.now()}),error=>({transportError:error.message,finishedAt:performance.now()}));
 let observed=false;
 for(let n=0;n<30;n++){
  observed=await ext.evaluate(`async()=> (await chrome.tabs.get(${receipts[0].tabId})).title===${JSON.stringify(marker)}`);
  if(observed)break;await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.equal(observed,true,'Must observe actual script execution before closing');
 const closedAt=performance.now();
 const closed=await ext.evaluate(`async()=>{
 const receipts=${JSON.stringify(receipts)},targets=await chrome.debugger.getTargets();
 for(const r of receipts){const tab=await chrome.tabs.get(r.tabId);if(tab.groupId!==r.groupId||!targets.some(t=>t.id===r.targetId&&t.tabId===r.tabId))throw Error('FIXTURE_CHANGED');}
 await chrome.tabs.remove(receipts.map(r=>r.tabId));
 return {closedTabIds:receipts.map(r=>r.tabId),groupStillExists:(await chrome.tabGroups.query({})).some(g=>g.id===receipts[0].groupId)};
 }`);
 assert.equal(closed.groupStillExists,false);evidence.closed=closed;
 const outcome=await pending;evidence.inFlight={elapsedMs:Math.round(outcome.finishedAt-started),afterCloseMs:Math.round(outcome.finishedAt-closedAt),result:outcome.result,transportError:outcome.transportError};
 assert.ok(outcome.transportError||outcome.result?.isError,'Closed in-flight operation must fail explicitly');
 pass('all fixture tabs and group closed during confirmed in-flight script; call returned an error');
 assert.deepEqual((await json('list_pages')).pages,[]);pass('same stdio connection lists empty workspace without blocking');
 const recoveryStart=performance.now();
 const reopened=await json('open_page',{url,slot:'main'});assert.notEqual(reopened.pageId,a.pageId);
 const old=await raw('evaluate_script',{pageId:a.pageId,function:'()=>true'});assert.equal(old.isError,true);assert.match(old.content[0].text,/PAGE_NOT_OWNED/);
 pass('same connection creates new page; stale page handle remains rejected');
 await call('evaluate_script',{pageId:reopened.pageId,function:`()=>{document.body.innerHTML='<button id="probe">Recovery click</button><output id="result">0</output>';document.querySelector('#probe').onclick=()=>document.querySelector('#result').textContent='1';return true;}`,waitForStableDom:false});
 const snapshot=await call('take_snapshot',{pageId:reopened.pageId});
 const line=snapshot.content.map(x=>x.text??'').join('\n').split('\n').find(l=>l.includes('button "Recovery click"'));
 const uid=line?.match(/uid=(\S+)/)?.[1];assert.ok(uid);
 await call('click',{pageId:reopened.pageId,uid});
 const read=await call('evaluate_script',{pageId:reopened.pageId,function:'()=>document.querySelector("#result").textContent',waitForStableDom:false});assert.match(read.content[0].text,/"1"/);
 evidence.recoveryMs=Math.round(performance.now()-recoveryStart);
 pass('new page supports snapshot, real click and reading the changed result');
 await call('navigate_page',{pageId:reopened.pageId,url});
 const health=await call('evaluate_script',{pageId:reopened.pageId,function:'()=>JSON.parse(document.body.innerText).connected',waitForStableDom:false});assert.match(health.content[0].text,/true/);
 pass('navigation and browser bridge remain usable without reconnecting or restarting services');
}catch(error){evidence.failure=error.stack;process.exitCode=1;console.error(error);}
finally{
 if(pending)await pending;
 try{for(const p of (await json('list_pages')).pages)await call('close_page',{pageId:p.pageId});}catch(error){evidence.cleanupError=error.message;process.exitCode=1;}
 await ext?.close();await client.close();
 await writeFile(outputPath,JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({inFlight:evidence.inFlight,recoveryMs:evidence.recoveryMs,connectionRestarts:evidence.connectionRestarts,checks:evidence.checks.length},null,2));
}
