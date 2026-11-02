import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceScope,acquireWorkspacePage} from '../dist/upstream/build/src/WorkspaceScope.js';
import {ToolHandler} from '../dist/upstream/build/src/ToolHandler.js';
test('SDK v2 request cancellation reaches the page queue',async()=>{
 const handler=new ToolHandler({name:'fixture',schema:{},annotations:{},verifyFilesSchema:{}},{},()=>{},null,()=>{});
 handler.handleScoped=async()=>{const guard=await acquireWorkspacePage(91);guard[Symbol.dispose]();return {};};
 const controller=new AbortController();controller.abort();
 await assert.rejects(handler.handle({__cbwTargetIds:['A'],__cbwDeadline:Date.now()+1000},{mcpReq:{signal:controller.signal}}),/REQUEST_CANCELLED/);
});
test('async target scopes stay separate while page work overlaps',async()=>{
 const a=workspaceScope.run(new Set(['A']),async()=>{const lock=await acquireWorkspacePage(1);await new Promise(r=>setTimeout(r,30));const ids=[...workspaceScope.getStore()];lock[Symbol.dispose]();return ids;});
 const b=workspaceScope.run(new Set(['B']),async()=>{const lock=await acquireWorkspacePage(2);const ids=[...workspaceScope.getStore()];lock[Symbol.dispose]();return ids;});
 assert.deepEqual(await b,['B']);assert.deepEqual(await a,['A']);
});
test('same-page work remains serialized',async()=>{
 const order=[];const first=await acquireWorkspacePage(3);
 const second=acquireWorkspacePage(3).then(lock=>{order.push('second');lock[Symbol.dispose]();});
 await new Promise(r=>setTimeout(r,10));assert.deepEqual(order,[]);order.push('first');first[Symbol.dispose]();await second;assert.deepEqual(order,['first','second']);
});
test('cancelled queued page work exits without releasing the preceding operation lock',async()=>{
 const first=await acquireWorkspacePage(44),controller=new AbortController();const scope=new Set(['A']);scope.control={signal:controller.signal,deadline:Date.now()+1000};
 const second=workspaceScope.run(scope,()=>acquireWorkspacePage(44));controller.abort();await assert.rejects(second,/REQUEST_CANCELLED/);
 let acquired=false;const third=acquireWorkspacePage(44).then(lock=>{acquired=true;lock[Symbol.dispose]();});
 await new Promise(r=>setTimeout(r,20));assert.equal(acquired,false);first[Symbol.dispose]();await third;assert.equal(acquired,true);
});
