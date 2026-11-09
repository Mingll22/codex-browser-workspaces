import {join} from 'node:path';
import {homedir} from 'node:os';
// HISTORICAL 0.3.x: synthetic identities and post-UNKNOWN same-page recovery
// predate 0.4's registered families and explicit execution quarantine.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {extensionTestClient} from '../scripts/extension-test-client.mjs';
const [anchor,configPath,output]=process.argv.slice(2);
const config=JSON.parse(await readFile(configPath,'utf8')),url=config.pairing.url.replace('ws:','http:')+'/health';
const baseline=await (await fetch(url)).json();
assert.match(baseline.adapter??'',/^0\.3\./,'HISTORICAL_FIXTURE: synthetic reliability identities are unsupported on 0.4; use its acceptance matrix');
const evidence={layer:'installed stdio + official Chrome MCP; two synthetic fixture identities',checks:[],timings:{}};
const clients=[];let ext;
async function fixture(){
 const thread=randomUUID(),client=new Client({name:'cbw-reliability-fixture',version:'0.3.1'});
 const transport=new StdioClientTransport({command:process.execPath,args:[join(process.env.XDG_DATA_HOME??join(homedir(),'.local/share'),'codex-browser-workspaces/dist/adapter/src/stdio.js'),configPath],stderr:'pipe'});transport.stderr?.on('data',()=>{});await client.connect(transport);
 const meta={threadId:thread,'x-codex-turn-metadata':{thread_id:thread,codex_version:'fixture'}};
 const raw=(name,args={},options={})=>client.callTool({name,arguments:args,_meta:meta},undefined,{timeout:65000,...options});
 const call=async(...args)=>{const r=await raw(...args);if(r.isError)throw Error(JSON.stringify(r));return r;};
 const json=async(...args)=>JSON.parse((await call(...args)).content[0].text);
 const f={thread,client,raw,call,json};clients.push(f);return f;
}
const pass=name=>{evidence.checks.push(name);console.log('PASS',name);};
async function observe(tabId,title){for(let i=0;i<50;i++){if(await ext.evaluate(`async()=> (await chrome.tabs.get(${tabId})).title===${JSON.stringify(title)}`))return;await new Promise(r=>setTimeout(r,100));}throw Error('IN_FLIGHT_SCRIPT_NOT_OBSERVED');}
try{
 ext=await extensionTestClient(anchor);const a=await fixture(),b=await fixture();
 const ap=await a.json('open_page',{url}),bp=await b.json('open_page',{url});evidence.threads=[a.thread,b.thread];
 const tabId=await ext.evaluate(`async()=> (await chrome.debugger.getTargets()).find(t=>t.id===${JSON.stringify(ap.pageId.split(':')[2])}).tabId`);
 const status=await a.json('list_pages');assert.equal(status.runtime.adapter,'0.3.1');assert.equal(status.runtime.extension,'0.3.1');assert.equal(status.runtime.client,'0.3.1');assert.equal(status.runtime.reconnectRecommended,false);assert.equal(status.workspace.status,'READY');pass('running adapter, extension and fresh stdio report matching 0.3.1');
 await b.call('evaluate_script',{pageId:bp.pageId,function:`()=>{document.body.innerHTML='<button id="count">Count</button>';globalThis.count=0;document.querySelector('#count').onclick=()=>globalThis.count++;return true;}`,waitForStableDom:false});
 const snapshot=await b.call('take_snapshot',{pageId:bp.pageId});const uid=snapshot.content.map(x=>x.text??'').join('\n').split('\n').find(l=>l.includes('button "Count"'))?.match(/uid=(\S+)/)?.[1];assert.ok(uid);
 const marker='cancel-'+randomUUID(),controller=new AbortController();
 const pending=a.raw('evaluate_script',{pageId:ap.pageId,function:`()=>{document.title=${JSON.stringify(marker)};return new Promise(r=>setTimeout(()=>r('done'),2500));}`,waitForStableDom:false},{signal:controller.signal}).then(result=>({result}),error=>({error:error.message}));
 await observe(tabId,marker);const started=Date.now();controller.abort();await pending;
 await b.call('click',{pageId:bp.pageId,uid});evidence.timings.cancelAndOtherThreadMs=Date.now()-started;
 assert.ok(evidence.timings.cancelAndOtherThreadMs<5000);pass('cancelling A preserves B connection and previously issued element reference');
 const cancelledStatus=await a.json('list_pages');assert.ok(cancelledStatus.diagnostics.some(e=>e.code==='REQUEST_CANCELLED'&&e.outcome==='UNKNOWN'));pass('in-flight cancellation remains UNKNOWN when delivered outside the request context');
 const queuedController=new AbortController();const queued=a.raw('evaluate_script',{pageId:ap.pageId,function:'()=>{globalThis.unwantedQueuedMutation=true;return true;}',waitForStableDom:false},{signal:queuedController.signal}).then(r=>({result:r}),e=>({error:e.message}));
 const timer=setTimeout(()=>queuedController.abort(),150);await queued;clearTimeout(timer);
 const fresh=await a.json('open_page',{url,slot:'recovery'});await a.call('take_snapshot',{pageId:fresh.pageId});pass('A can open and operate another page after cancelling its running/queued requests');
 await new Promise(r=>setTimeout(r,2600));
 const markerResult=await a.call('evaluate_script',{pageId:ap.pageId,function:'()=>globalThis.unwantedQueuedMutation===true',waitForStableDom:false});assert.match(markerResult.content[0].text,/false/);pass('cancelled queued browser mutation never executes later');
 const timeoutMarker='timeout-'+randomUUID();const timeoutStart=Date.now();
 const timeout=a.raw('evaluate_script',{pageId:ap.pageId,function:`()=>{document.title=${JSON.stringify(timeoutMarker)};return new Promise(r=>setTimeout(()=>r('late'),28000));}`,waitForStableDom:false});
 await observe(tabId,timeoutMarker);await b.call('click',{pageId:bp.pageId,uid});pass('B remains usable while A has a slow script');
 const timed=await timeout;evidence.timings.timeoutMs=Date.now()-timeoutStart;assert.equal(timed.isError,true);assert.match(timed.content[0].text,/UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN/);assert.ok(evidence.timings.timeoutMs<30000);
 await b.call('click',{pageId:bp.pageId,uid});const count=await b.call('evaluate_script',{pageId:bp.pageId,function:'()=>globalThis.count',waitForStableDom:false});assert.match(count.content[0].text,/\b3\b/);pass('25s upstream timeout retains B transport, epoch and working element reference');
 const before=await a.json('list_pages');assert.ok(before.diagnostics.some(e=>e.code==='UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN'));assert.ok(before.diagnostics.every(e=>e.thread===a.thread));pass('bounded diagnostic history is scoped to the requesting thread');
 await a.call('close_page',{pageId:ap.pageId});const gone=await a.raw('take_snapshot',{pageId:ap.pageId});assert.equal(gone.structuredContent.error.reason,'CLOSED');assert.equal(gone.structuredContent.error.outcome,'NOT_STARTED');pass('closed page returns structured CLOSED reason without adopting another page');
 const cross=await a.raw('take_snapshot',{pageId:bp.pageId});assert.equal(cross.structuredContent.error.reason,'UNKNOWN_OR_FOREIGN_PAGE');pass('foreign handles stay rejected without revealing another workspace');
 const activeBefore=await ext.evaluate('async()=> (await chrome.tabs.query({active:true})).map(t=>t.id).sort()');
 const screenshots=await Promise.all([a.call('take_screenshot',{pageId:fresh.pageId}),b.call('take_screenshot',{pageId:bp.pageId})]);
 for(let i=0;i<screenshots.length;i++){const image=screenshots[i].content.find(x=>x.type==='image');assert.ok(image);await writeFile(output+'.capture-'+i+'.png',Buffer.from(image.data,'base64'));}
 const activeAfter=await ext.evaluate('async()=> (await chrome.tabs.query({active:true})).map(t=>t.id).sort()');assert.deepEqual(activeAfter,activeBefore);pass('concurrent screenshots produce real images and restore the prior tab selection');
}catch(error){evidence.failure=error.stack;console.error(error);process.exitCode=1;}
finally{
 for(const f of clients){try{for(const p of (await f.json('list_pages')).pages)await f.call('close_page',{pageId:p.pageId});}catch(error){evidence.cleanupError=error.message;process.exitCode=1;}await f.client.close();}
 await ext?.close();await writeFile(output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}
