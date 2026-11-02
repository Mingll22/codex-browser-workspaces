import {Rpc} from '../dist/adapter/src/rpc.js';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const config=JSON.parse(await readFile(process.env.CBW_TEST_CONFIG??'.artifacts/dev-config.json','utf8'));
const prefix=process.env.CBW_TEST_PREFIX??'acceptance';
const connections=[];
for(const name of ['a','b']){
 const thread=(await readFile(`.artifacts/${prefix}-${name}-cli.jsonl`,'utf8')).trim().split('\n').map(JSON.parse).find(x=>x.type==='thread.started').thread_id;
 const rpc=new Rpc(config.socket);
 connections.push({rpc,async call(name,args={}){const r=await rpc.call('call',{name,args,meta:{threadId:thread,'x-codex-turn-metadata':{thread_id:thread,codex_version:'0.162.1'}}});if(r.isError)throw new Error(JSON.stringify(r));return r;},async json(name,args={}){return JSON.parse((await this.call(name,args)).content[0].text);}});
}
const [a,b]=connections;let result;
try{
 const pa=await a.json('open_page',{url:'http://127.0.0.1:19228/concurrency-a'});const pb=await b.json('open_page',{url:'http://127.0.0.1:19228/concurrency-b'});
 let aFinished=false;
 const slow=a.call('evaluate_script',{pageId:pa.pageId,function:'async()=>{await new Promise(resolve=>setTimeout(resolve,2000));return "A finished"}',waitForStableDom:false}).then(r=>{aFinished=true;return r;});
 await new Promise(r=>setTimeout(r,100));const start=performance.now();
 const fast=await b.call('evaluate_script',{pageId:pb.pageId,function:'()=>location.pathname',waitForStableDom:false});
 const elapsed=Math.round(performance.now()-start);assert.match(fast.content[0].text,/concurrency-b/);assert.equal(aFinished,false,'B should finish while A is still running');
 await slow;result={pass:true,slowPageDelayMs:2000,otherPageLatencyMs:elapsed};console.log(result);
}finally{
 for(const c of connections){try{for(const p of (await c.json('list_pages')).pages)await c.call('close_page',{pageId:p.pageId});}finally{c.rpc.close();}}
 if(result)await writeFile('.artifacts/concurrency-results.json',JSON.stringify(result,null,2)+'\n');
}
