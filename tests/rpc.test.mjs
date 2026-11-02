import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Rpc} from '../dist/adapter/src/rpc.js';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'cbw-rpc-'));const path=join(dir,'broker.sock');
 const sockets=new Set(),requests=[];let received;
 const server=createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';
  socket.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const m=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);if(m.method==='ping')continue;requests.push(m);received?.(m,socket);if(m.method!=='hold')socket.write(JSON.stringify({id:m.id,result:{method:m.method}})+'\n');}});
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve);});
 const rpc=new Rpc(path);await rpc.ready;
 t.after(async()=>{rpc.close();for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 return {rpc,requests,sockets,onRequest:fn=>received=fn};
}
test('broker disconnect rejects in-flight mutations once and next calls reconnect with one hello',async t=>{
 const f=await fixture(t);
 const arrived=new Promise(resolve=>f.onRequest((m,socket)=>{if(m.method==='hold'){socket.destroy();resolve();}}));
 const lost=f.rpc.call('hold',{mutation:true});await arrived;await assert.rejects(lost,/BROKER_DISCONNECTED/);
 const results=await Promise.all([f.rpc.call('read-a'),f.rpc.call('read-b')]);
 assert.deepEqual(results,[{method:'read-a'},{method:'read-b'}]);
 assert.equal(f.requests.filter(r=>r.method==='hold').length,1);assert.equal(f.requests.filter(r=>r.method==='hello').length,1);
});
test('a second disconnect also reconnects without changing request parameters',async t=>{
 const f=await fixture(t);
 for(let i=0;i<2;i++){
  const lost=f.rpc.call('hold',{index:i});
  // Close from the server only after the request has actually arrived.
  f.onRequest((m,socket)=>{if(m.method==='hold')socket.destroy();});
  await assert.rejects(lost,/BROKER_DISCONNECTED/);
  await f.rpc.call('read',{index:i});
 }
 assert.equal(f.requests.filter(r=>r.method==='hello').length,2);
 assert.deepEqual(f.requests.filter(r=>r.method==='read').map(r=>r.params),[{index:0},{index:1}]);
});
test('explicitly closed clients stay closed and release replacement connections',async t=>{
 const f=await fixture(t);f.rpc.close();await assert.rejects(f.rpc.call('read'),/BROKER_DISCONNECTED/);assert.equal(f.requests.length,0);
});
test('deadline bounds a silent connected peer; cancellation is sent and the connection remains usable',async t=>{
 const f=await fixture(t);const started=Date.now();
 await assert.rejects(f.rpc.call('hold',{}, {deadline:Date.now()+30}),/REQUEST_TIMEOUT/);
 assert.ok(Date.now()-started<1000);await f.rpc.call('read');
 assert.equal(f.requests.filter(r=>r.method==='hold').length,1);assert.equal(f.requests.filter(r=>r.method==='cancel').length,1);
});
test('caller abort cancels one request and never replays it',async t=>{
 const f=await fixture(t),controller=new AbortController();f.onRequest(m=>{if(m.method==='hold')controller.abort();});
 await assert.rejects(f.rpc.call('hold',{}, {signal:controller.signal}),/REQUEST_CANCELLED/);await f.rpc.call('read');
 assert.equal(f.requests.filter(r=>r.method==='hold').length,1);assert.equal(f.requests.filter(r=>r.method==='cancel').length,1);
});
