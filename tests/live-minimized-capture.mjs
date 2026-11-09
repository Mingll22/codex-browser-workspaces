import {join} from 'node:path';
import {homedir} from 'node:os';
// HISTORICAL 0.3.x integration: installed MCP + real Chrome, disposable
// protocol fixture identities. Does not impersonate a real Codex thread.
// Its same-page recovery after cancellation is not the 0.4 UNKNOWN contract.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {extensionTestClient} from '../scripts/extension-test-client.mjs';
const [anchor,output]=process.argv.slice(2);assert.match(anchor,/^[A-F0-9]{32}$/);assert.ok(output);
const configPath=process.env.CBW_TEST_CONFIG??join(process.env.XDG_STATE_HOME??join(homedir(),'.local/state'),'codex-browser-workspaces/config.json');
const config=JSON.parse(await readFile(configPath,'utf8'));
const baseline=await (await fetch(config.pairing.url.replace('ws:','http:')+'/health')).json();
assert.match(baseline.adapter??'',/^0\.3\./,'HISTORICAL_FIXTURE: synthetic minimized-capture identities cannot run on 0.4; use its acceptance matrix');
await mkdir(output,{recursive:true});
const evidence={layer:'installed MCP + real Chrome, synthetic disposable identities',checks:[],captures:[]},fixtures=[];
const ext=await extensionTestClient(anchor);
async function fixture(){
 const thread=randomUUID(),client=new Client({name:'minimized-capture-fixture',version:'0.3.1'});
 const transport=new StdioClientTransport({command:process.execPath,args:[join(process.env.XDG_DATA_HOME??join(homedir(),'.local/share'),'codex-browser-workspaces/dist/adapter/src/stdio.js'),configPath],stderr:'pipe'});transport.stderr.on('data',()=>{});await client.connect(transport);
 const meta={threadId:thread,'x-codex-turn-metadata':{thread_id:thread,codex_version:'fixture'}};
 const raw=(name,args={},options={})=>client.callTool({name,arguments:args,_meta:meta},undefined,{timeout:35000,...options});
 const call=async(...args)=>{const r=await raw(...args);assert.equal(r.isError,undefined,JSON.stringify(r.structuredContent??r.content));return r;};
 const f={thread,client,raw,call,pages:[]};fixtures.push(f);return f;
}
const state=()=>ext.evaluate(`async()=>{const anchor=(await chrome.debugger.getTargets()).find(t=>t.id==='${anchor}');const tab=await chrome.tabs.get(anchor.tabId);return {window:(await chrome.windows.get(tab.windowId)).state,active:(await chrome.tabs.query({windowId:tab.windowId,active:true})).map(t=>t.id)};}`);
async function shot(f,p,name,options={}){
 const start=Date.now(),r=await f.call('take_screenshot',{pageId:p.pageId,...options});const image=r.content.find(c=>c.type==='image');assert.ok(image);await writeFile(output+'/'+name+'.png',Buffer.from(image.data,'base64'));evidence.captures.push({name,ms:Date.now()-start,bytes:Buffer.from(image.data,'base64').length});assert.deepEqual(await state(),evidence.before);
}
try{
 evidence.before=await state();assert.equal(evidence.before.window,'minimized');
 const a=await fixture(),b=await fixture();
 for(const f of [a,b]){const p=JSON.parse((await f.call('open_page',{url:'about:blank',slot:'minimized-test'})).content[0].text);f.pages.push(p);const status=JSON.parse((await f.call('list_pages')).content[0].text);assert.deepEqual(status.runtime,{adapter:'0.3.1',upstream:'1.11.0',extension:'0.3.1',client:'0.3.1',reconnectRecommended:false});evidence.runtime=status.runtime;}
 for(let i=1;i<=3;i++)for(const [f,label,color] of [[a,'A','#243b70'],[b,'B','#385d30']]){
  const p=f.pages[0];await f.call('evaluate_script',{pageId:p.pageId,function:`()=>{document.title='Minimized fixture ${label}';document.body.style.cssText='background:${color};color:white;font:48px sans-serif;padding:40px';document.body.innerHTML='<h1>MINIMIZED ${label} FRESH ${i}</h1><div style="width:${100+i*50}px;height:200px;background:#ea9c20"></div>';return document.body.textContent;}`,waitForStableDom:false});
  await shot(f,p,label+'-'+i,{fullPage:i===3});
 }
 evidence.checks.push('six alternating fresh screenshots including full-page, minimized and original selection preserved');
 await a.call('evaluate_script',{pageId:a.pages[0].pageId,function:"()=>{const b=document.createElement('button');b.textContent='Remove me';b.id='remove';document.body.append(b);return true;}",waitForStableDom:false});
 const snap=await a.call('take_snapshot',{pageId:a.pages[0].pageId});
 const line=snap.content.map(c=>c.text??'').join('\n').split('\n').find(l=>l.includes('button \"Remove me\"'));const uid=line?.match(/uid=(\S+)/)?.[1];assert.ok(uid);
 await a.call('evaluate_script',{pageId:a.pages[0].pageId,function:"()=>{document.querySelector('#remove').remove();return true;}",waitForStableDom:false});
 const failed=await a.raw('take_screenshot',{pageId:a.pages[0].pageId,uid});assert.equal(failed.isError,true);evidence.failure=failed.structuredContent??failed.content;
 await shot(b,b.pages[0],'after-failure');evidence.checks.push('failed screenshot does not block the next capture');
 // Give capture enough real work to observe its tab activation before aborting.
 await a.call('evaluate_script',{pageId:a.pages[0].pageId,function:"()=>{document.body.style.height='18000px';document.body.style.background='linear-gradient(#123,#fa3)';return true;}",waitForStableDom:false});
 const controller=new AbortController();let settled=false;
 const pending=a.raw('take_screenshot',{pageId:a.pages[0].pageId,fullPage:true},{signal:controller.signal}).then(r=>({result:r}),e=>({error:e.message})).finally(()=>settled=true);
 const timer=setTimeout(()=>{evidence.cancelWasPending=!settled;controller.abort();},75);
 evidence.cancelled=await pending;clearTimeout(timer);assert.equal(evidence.cancelWasPending,true);assert.ok(evidence.cancelled.error);
 await shot(b,b.pages[0],'after-cancellation');
 await shot(a,a.pages[0],'same-page-after-cancellation');evidence.checks.push('cancelling a pending screenshot releases capture queue and same-page work');
 evidence.after=await state();assert.deepEqual(evidence.after,evidence.before);evidence.success=true;
}catch(e){evidence.error=e.stack;process.exitCode=1;console.error(e);}
finally{
 for(const f of fixtures){for(const p of f.pages){try{await f.call('close_page',{pageId:p.pageId});}catch(e){evidence.cleanupError=e.message;process.exitCode=1;}}await f.client.close();}
 evidence.final=await state();await ext.close();await writeFile(output+'/results.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}
