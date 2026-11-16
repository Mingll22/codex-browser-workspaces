import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Upstream} from '../dist/adapter/src/upstream.js';
import {Inspector} from '../scripts/reconcile-execution.mjs';

test('drain uses the existing client and exact scope, never replaying the original action',async()=>{
 const upstream=new Upstream('http://127.0.0.1:9222'),calls=[];
 upstream.client={transport:{pid:process.pid},async callTool({name,arguments:args}){calls.push({name,args});return {content:[],structuredContent:{pages:[{id:7,targetId:'exact'}]}};}};
 const proof=await upstream.drainExecution('exact',process.pid,Date.now()+1000);await proof.readPages();
 assert.deepEqual(calls.map(c=>c.name),['list_pages','take_snapshot','list_pages']);
 assert.ok(calls.every(c=>c.args.__cbwTargetIds.length===1&&c.args.__cbwTargetIds[0]==='exact'));assert.equal(calls[1].args.pageId,7);
});

test('drain rejects missing/replaced clients, new processes and failed snapshots',async()=>{
 const upstream=new Upstream('http://127.0.0.1:9222');await assert.rejects(upstream.drainExecution('exact',process.pid,Date.now()),/TRANSPORT_MISSING/);
 const client={transport:{pid:process.pid},async callTool({name}){return name==='list_pages'?{structuredContent:{pages:[{id:7,targetId:'exact'}]}}:{isError:true};}};
 upstream.client=client;await assert.rejects(upstream.drainExecution('exact',process.pid,0),/TRANSPORT_CHANGED/);
 await assert.rejects(upstream.drainExecution('exact',process.pid,Date.now()+1000),/UNPROVEN/);
 client.callTool=async()=>{upstream.epoch='replaced';return {structuredContent:{pages:[{id:7,targetId:'exact'}]}};};
 await assert.rejects(upstream.drainExecution('exact',process.pid,Date.now()+1000),/TRANSPORT_CHANGED/);
});

test('inspector finds the unique existing module instance in a disposable Node process',async t=>{
 const moduleURL=new URL('../dist/adapter/src/workspaces.js',import.meta.url).href;
 const source=`import(${JSON.stringify(moduleURL)}).then(({Workspaces})=>{globalThis.fixture=new Workspaces({}, {}, '/unused');process.stdout.write('READY');});setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--inspect=127.0.0.1:0','-e',source],{stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());let logs='';
 const url=await new Promise((done,fail)=>{child.stderr.on('data',chunk=>{logs+=chunk;const match=logs.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/);if(match)done(match[0]);});child.once('error',fail);});
 if(!child.stdout.readableLength)await once(child.stdout,'readable');child.stdout.read();
 const inspector=await Inspector.connect(url);t.after(()=>inspector.close());
 const id=await inspector.instance(moduleURL,'Workspaces');
 const result=await inspector.call('Runtime.callFunctionOn',{objectId:id,functionDeclaration:'function(){return this.leases.snapshot();}',returnByValue:true});
 assert.deepEqual(result.result.value,{});inspector.close();child.kill();await once(child,'exit');
});
