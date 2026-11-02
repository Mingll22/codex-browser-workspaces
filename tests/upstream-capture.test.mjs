import test from 'node:test';
import assert from 'node:assert/strict';
import {beginMinimizedCapture} from '../dist/upstream/build/src/WorkspaceCapture.js';
import {screenshot} from '../dist/upstream/build/src/tools/screenshot.js';

function fixture(windowState='minimized'){
 const calls=[];
 const client={async send(method,args){calls.push({method,args});if(method==='Browser.getWindowForTarget')return {bounds:{windowState}};}};
 return {calls,client,page:{_client:()=>client}};
}
test('ordinary windows do not start a screencast',async()=>{
 for(const state of ['normal','maximized','fullscreen']){
  const f=fixture(state);assert.equal(await beginMinimizedCapture(f.page),undefined);
  assert.deepEqual(f.calls.map(c=>c.method),['Browser.getWindowForTarget']);
 }
});
test('minimized capture starts a tiny frame producer and stops after capture failure',async()=>{
 const f=fixture();
 await assert.rejects((async()=>{
  const lease=await beginMinimizedCapture(f.page);
  try{throw Error('SCREENSHOT_FAILED');}finally{await lease[Symbol.asyncDispose]();}
 })(),/SCREENSHOT_FAILED/);
 assert.deepEqual(f.calls.map(c=>c.method),['Browser.getWindowForTarget','Page.startScreencast','Page.stopScreencast']);
 assert.deepEqual(f.calls[1].args,{format:'jpeg',quality:0,maxWidth:1,maxHeight:1,everyNthFrame:1});
});
test('screencast start and cleanup errors are preserved',async()=>{
 const f=fixture(),send=f.client.send;
 f.client.send=async(method,...args)=>{if(method==='Page.startScreencast')throw Error('START_FAILED');return send(method,...args);};
 await assert.rejects(beginMinimizedCapture(f.page),/START_FAILED/);
 f.client.send=send;const lease=await beginMinimizedCapture(f.page);
 f.client.send=async()=>{throw Error('STOP_FAILED');};
 await assert.rejects(lease[Symbol.asyncDispose](),/STOP_FAILED/);
});
test('the patched official screenshot handler awaits frame cleanup on success, failure and cancellation',async()=>{
 for(const outcome of ['success','SCREENSHOT_FAILED','REQUEST_CANCELLED']){
  const f=fixture();let releaseStop,stopping;
  const stopped=new Promise(resolve=>releaseStop=resolve),stopEntered=new Promise(resolve=>stopping=resolve);
  const send=f.client.send;f.client.send=async(method,...args)=>{const result=await send(method,...args);if(method==='Page.stopScreencast'){stopping();await stopped;}return result;};
  f.page.screenshot=async()=>{f.calls.push({method:'official screenshot'});if(outcome!=='success')throw Error(outcome);return Buffer.from('png-fixture');};
  const request={params:{format:'png'},page:{pptrPage:f.page}};
  let returned=false;
  const pending=screenshot({}).handler(request,{appendResponseLine(){},attachImage(){}},{}).finally(()=>returned=true);
  const result=outcome==='success'?pending:assert.rejects(pending,new RegExp(outcome));
  await stopEntered;assert.equal(returned,false);releaseStop();await result;
  assert.deepEqual(f.calls.map(c=>c.method),['Browser.getWindowForTarget','Page.startScreencast','official screenshot','Page.stopScreencast']);
 }
});
test('cancellation stops once immediately and finally waits for the same stop',async()=>{
 const f=fixture(),controller=new AbortController();
 const lease=await beginMinimizedCapture(f.page,controller.signal);
 controller.abort();assert.equal(f.calls.at(-1).method,'Page.stopScreencast');
 await lease[Symbol.asyncDispose]();
 assert.equal(f.calls.filter(c=>c.method==='Page.stopScreencast').length,1);
});
test('cancellation while start is pending cleans the stream before returning an error',async()=>{
 const f=fixture(),controller=new AbortController(),send=f.client.send;
 f.client.send=async(method,...args)=>{const result=await send(method,...args);if(method==='Page.startScreencast')controller.abort();return result;};
 await assert.rejects(beginMinimizedCapture(f.page,controller.signal),/REQUEST_CANCELLED/);
 assert.equal(f.calls.filter(c=>c.method==='Page.stopScreencast').length,1);
});
