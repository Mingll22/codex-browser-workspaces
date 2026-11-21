import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import WebSocket from 'ws';
import {VERSION} from '../dist/adapter/src/version.js';

test('the candidate broker publishes safe status and runs expiry checks with browser cleanup disabled',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'cbw-count-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const extensionId='a'.repeat(32),token='disposable-test-token',socket=join(dir,'broker.sock'),config=join(dir,'config.json');
 await writeFile(config,JSON.stringify({stateDir:dir,socket,pairing:{url:`ws://127.0.0.1:${port}`,extensionId,token},browserURL:'http://127.0.0.1:9222',maxTabs:8,detachedTtlMs:null,closedThreadGraceMs:null}));
 const stateFile=join(dir,'workspaces.json'),target='fixture-generation/previous-target';
 await writeFile(stateFile,JSON.stringify({version:2,leases:{
  [target]:{version:1,owner:'previous-caller',lastUsed:0,expiresAt:0,executing:0,unknown:true,unknownCheck:{expiresAt:0,attempts:2}},
 }}));
 const child=spawn(process.execPath,['dist/adapter/src/broker.js',config],{stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',data=>stderr+=data);
 let peer,client;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CANDIDATE_START_TIMEOUT '+stderr)),15000);child.once('exit',code=>{clearTimeout(timer);reject(Error('Candidate exit '+code+' '+stderr));});child.stdout.on('data',data=>{if(String(data).includes('broker ready:')){clearTimeout(timer);resolve();}});});
  peer=new WebSocket(`ws://127.0.0.1:${port}`,{headers:{Origin:`chrome-extension://${extensionId}`}});await once(peer,'open');
  const nextStatus=(count,accept=()=>true)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{peer.off('message',handle);reject(Error('STATUS_NOT_PUBLISHED '+count));},5000);function handle(raw){const message=JSON.parse(raw);if(message.type==='status'&&message.data.mcpConnections===count&&accept(message.data)){clearTimeout(timer);peer.off('message',handle);resolve(message.data);}}peer.on('message',handle);});
  let changed=nextStatus(0);peer.send(JSON.stringify({type:'hello',token,generation:'fixture-generation',version:'0.4.0',pageModelVersion:2}));assert.equal((await changed).activeThreads,0);
  client=new Client({name:'browser-workspace-fixture',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:['dist/adapter/src/stdio.js',config]});
  changed=nextStatus(1);await client.connect(transport);let status=await changed;
  assert.deepEqual(status.workspaceMcpConnections,{},'an initialized client has no workspace until its first identified browser call');
  if(status.leasedTargets.length)status=await nextStatus(1,data=>data.leasedTargets.length===0);
  const stored=JSON.parse(await readFile(stateFile,'utf8')).leases[target];
  assert.equal(stored.unknown,false);
  assert.equal(stored.unknownCheck,undefined);
  assert.match(client.getInstructions(),/wait about three minutes and call list_pages/);
  const {tools}=await client.listTools();
  for(const name of ['list_pages','release_page','evaluate_script']){
    assert.match(tools.find(tool=>tool.name===name).description,/wait about three minutes and call list_pages/);
  }
  assert.equal(status.brokerVersion,VERSION);assert.deepEqual(status.leasedTargets,[]);assert.ok(Number.isFinite(status.observedAt));assert.ok(!JSON.stringify(status).includes(token));
  changed=nextStatus(0);await client.close();await changed;
 }finally{await client?.close();peer?.terminate();child.kill('SIGTERM');await once(child,'exit');}
});
