import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket from 'ws';
import {Bridge} from '../dist/adapter/src/bridge.js';
const pairing={url:'ws://127.0.0.1:0',token:'test-pairing-not-a-real-credential',extensionId:'a'.repeat(32)};
async function setup(t){const bridge=new Bridge(pairing);await bridge.listen();t.after(()=>bridge.close());return [bridge,`ws://127.0.0.1:${bridge.server.address().port}`];}
async function peer(url,token=pairing.token){const ws=new WebSocket(url,{headers:{Origin:`chrome-extension://${pairing.extensionId}`}});await once(ws,'open');ws.send(JSON.stringify({type:'hello',token,generation:'test-generation'}));await delay(10);return ws;}
test('ordinary webpage origins cannot connect',async t=>{
 const [bridge,url]=await setup(t);
 const ws=new WebSocket(url,{headers:{Origin:'https://example.org'}});
 const [error]=await once(ws,'error');assert.match(error.message,/403/);assert.equal(bridge.generation,undefined);
});
test('origin alone does not authorize an extension connection',async t=>{
 const [bridge,url]=await setup(t);const ws=new WebSocket(url,{headers:{Origin:`chrome-extension://${pairing.extensionId}`}});
 await once(ws,'open');const closed=once(ws,'close');ws.send(JSON.stringify({type:'hello',token:'wrong',generation:'bad'}));
 const [code]=await closed;assert.equal(code,1008);assert.equal(bridge.generation,undefined);
});
test('correlated responses and disconnect do not replay mutations',async t=>{
 const [bridge,url]=await setup(t);const ws=await peer(url);
 const request=once(ws,'message');const result=bridge.request('open',{threadId:'fixture'});const [raw]=await request;const msg=JSON.parse(raw);
 ws.send(JSON.stringify({type:'response',id:msg.id,result:{tabId:1}}));assert.deepEqual(await result,{tabId:1});
 const uncertain=bridge.request('close',{tabId:1});const rejected=assert.rejects(uncertain,/BRIDGE_DISCONNECTED/);ws.close();await rejected;
 const reconnected=await peer(url);let messages=0;reconnected.on('message',()=>messages++);await delay(20);assert.equal(messages,0);reconnected.close();
});
test('cancellation propagates to the extension without disconnecting other requests',async t=>{
 const {operations}=await import('../dist/adapter/src/operation.js');const [bridge,url]=await setup(t);const ws=await peer(url);
 const controller=new AbortController();const messages=[];ws.on('message',raw=>{const m=JSON.parse(raw);messages.push(m);if(m.type==='request'&&m.method==='open')controller.abort();else if(m.type==='request')ws.send(JSON.stringify({type:'response',id:m.id,result:{ok:true}}));});
 await assert.rejects(operations.run({id:'test',signal:controller.signal,deadline:Date.now()+5000},()=>bridge.request('open')),/REQUEST_CANCELLED/);
 assert.deepEqual(await bridge.request('list'),{ok:true});assert.equal(messages.filter(m=>m.type==='cancel').length,1);ws.close();
});

test('authenticated extension status requests read current counters without a tool or page mutation',async t=>{
 const [bridge,url]=await setup(t);let requests=0;
 bridge.onStatusRequest=()=>({mcpConnections:++requests,activeThreads:0,leasedTargets:[]});
 const ws=new WebSocket(url,{headers:{Origin:`chrome-extension://${pairing.extensionId}`}});await once(ws,'open');
 const first=once(ws,'message');ws.send(JSON.stringify({type:'hello',token:pairing.token,generation:'g',pageModelVersion:2}));
 assert.equal(JSON.parse((await first)[0]).data.mcpConnections,1);
 const next=once(ws,'message');ws.send(JSON.stringify({type:'status_request'}));assert.equal(JSON.parse((await next)[0]).data.mcpConnections,2);assert.equal(bridge.pageModelVersion,2);ws.close();
});
