// HISTORICAL 0.3 integration using prior owned test receipts.
import {Rpc} from '../dist/adapter/src/rpc.js';
import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {monitorForeground} from './foreground-monitor.mjs';
const execute=promisify(execFile);
const foreground=async()=>Number((await execute('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','Add-Type -Name CBWFocus -Namespace Win32 -MemberDefinition \'[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();\'; [Win32.CBWFocus]::GetForegroundWindow().ToInt64()'])).stdout.trim());
const cfg=JSON.parse(await readFile(process.env.CBW_TEST_CONFIG??'.artifacts/dev-config.json','utf8'));
const historicalHealth=await (await fetch(cfg.pairing.url.replace('ws:','http:')+'/health')).json();
assert.match(historicalHealth.adapter??'',/^0\.3\./,'HISTORICAL_FIXTURE: replayed prior CLI receipts target 0.3; use the 0.4 acceptance matrix');
const prefix=process.env.CBW_TEST_PREFIX??'acceptance';
const output=process.env.CBW_TEST_OUTPUT??'screenshot';
const clients=[];const result={samples:[],focusBefore:await foreground()};
const receipts=[];
const stopMonitor=await monitorForeground();
const value=r=>JSON.parse(r.content[0].text.match(/```json\n([\s\S]*?)\n```/)[1]);
for(const label of ['a','b']){
 const thread=(await readFile(`.artifacts/${prefix}-${label}-cli.jsonl`,'utf8')).trim().split('\n').map(JSON.parse).find(x=>x.type==='thread.started').thread_id;
 const rpc=new Rpc(cfg.socket);clients.push({rpc,label,async call(name,args={}){const r=await rpc.call('call',{name,args,meta:{threadId:thread,'x-codex-turn-metadata':{thread_id:thread,codex_version:'0.162.1'}}});if(r.isError)throw new Error(r.content.map(x=>x.text??'').join('\n'));return r;},async json(name,args={}){return JSON.parse((await this.call(name,args)).content[0].text);}});
}
try{
 for(const c of clients){c.page=await c.json('open_page',{url:'http://127.0.0.1:19228/screenshot-'+c.label});receipts.push({c,page:c.page});}
 const [a,b]=clients;const before=value(await b.call('evaluate_script',{pageId:b.page.pageId,function:'()=>[innerWidth,innerHeight]',waitForStableDom:false}));
 await a.call('emulate',{pageId:a.page.pageId,viewport:'800x600'});
 const own=value(await a.call('evaluate_script',{pageId:a.page.pageId,function:'()=>[innerWidth,innerHeight]',waitForStableDom:false}));const other=value(await b.call('evaluate_script',{pageId:b.page.pageId,function:'()=>[innerWidth,innerHeight]',waitForStableDom:false}));
 assert.deepEqual(own,[800,600]);assert.deepEqual(other,before);result.pageEmulationIsolated=true;
 await a.call('emulate',{pageId:a.page.pageId});
 for(const c of clients){c.reference=await c.json('open_page',{url:'http://127.0.0.1:19228/reference-'+c.label,slot:'reference'});receipts.push({c,page:c.reference});}
 for(let round=0;round<4;round++){
  const samples=await Promise.all(clients.map(async c=>{
   try{
    const page=round%2?c.reference:c.page;
    await c.call('evaluate_script',{pageId:page.pageId,function:`()=>{document.querySelector('h1').textContent=${JSON.stringify('CBW screenshot '+c.label+' '+round)};return true}`,waitForStableDom:false});
    const start=performance.now();const r=await c.call('take_screenshot',{pageId:page.pageId});const image=r.content.find(x=>x.type==='image');assert.ok(image);
    const filename=`.artifacts/${output}-${c.label}-${round}.png`;await writeFile(filename,Buffer.from(image.data,'base64'));
    return {label:c.label,round,pass:true,durationMs:Math.round(performance.now()-start),filename};
   }catch(e){return {label:c.label,round,pass:false,error:e.message};}
  }));result.samples.push(...samples);console.log(samples);if(samples.some(s=>!s.pass)){process.exitCode=1;break;}
 }
}catch(e){result.error=e.message;console.error(e);process.exitCode=1;}
finally{
 result.focusAfter=await foreground();result.foregroundUnchanged=result.focusBefore===result.focusAfter;
 for(const {c,page} of receipts){try{await c.call('close_page',{pageId:page.pageId});}catch(e){result.cleanupError=e.message;process.exitCode=1;}}
 for(const c of clients)c.rpc.close();
 result.foregroundTimeline=await stopMonitor();
 if(result.foregroundTimeline.changes.length)process.exitCode=1;
 if(!result.foregroundUnchanged)process.exitCode=1;
 await writeFile(`.artifacts/${output}-results.json`,JSON.stringify(result,null,2)+'\n');console.log('Foreground unchanged:',result.foregroundUnchanged);
}
