import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import WebSocket from 'ws';
import {Rpc} from '../dist/adapter/src/rpc.js';
import {VERSION} from '../dist/adapter/src/version.js';

test('real candidate broker counts hello/disconnect and publishes only safe status summaries',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'cbw-count-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const extensionId='a'.repeat(32),token='disposable-test-token',socket=join(dir,'broker.sock'),config=join(dir,'config.json');
 await writeFile(config,JSON.stringify({stateDir:dir,socket,pairing:{url:`ws://127.0.0.1:${port}`,extensionId,token},browserURL:'http://127.0.0.1:9222',maxTabs:8,detachedTtlMs:null,closedThreadGraceMs:null}));
 const child=spawn(process.execPath,['dist/adapter/src/broker.js',config],{stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',data=>stderr+=data);
 let peer,rpc;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CANDIDATE_START_TIMEOUT '+stderr)),15000);child.once('exit',code=>{clearTimeout(timer);reject(Error('Candidate exit '+code+' '+stderr));});child.stdout.on('data',data=>{if(String(data).includes('broker ready:')){clearTimeout(timer);resolve();}});});
  peer=new WebSocket(`ws://127.0.0.1:${port}`,{headers:{Origin:`chrome-extension://${extensionId}`}});await once(peer,'open');
  const nextStatus=count=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{peer.off('message',handle);reject(Error('STATUS_NOT_PUBLISHED '+count));},5000);function handle(raw){const message=JSON.parse(raw);if(message.type==='status'&&message.data.mcpConnections===count){clearTimeout(timer);peer.off('message',handle);resolve(message.data);}}peer.on('message',handle);});
  let changed=nextStatus(0);peer.send(JSON.stringify({type:'hello',token,generation:'fixture-generation',version:'0.4.0',pageModelVersion:2}));assert.equal((await changed).activeThreads,0);
  rpc=new Rpc(socket);await rpc.ready;changed=nextStatus(1);await rpc.call('hello',{cwd:process.cwd(),version:'0.4.0'});const status=await changed;
  assert.equal(status.brokerVersion,VERSION);assert.deepEqual(status.leasedTargets,[]);assert.ok(Number.isFinite(status.observedAt));assert.ok(!JSON.stringify(status).includes(token));
  changed=nextStatus(0);rpc.close();await changed;
 }finally{rpc?.close();peer?.terminate();child.kill('SIGTERM');await once(child,'exit');}
});
