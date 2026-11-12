import test from 'node:test';
import assert from 'node:assert/strict';
import {Ajv2020} from 'ajv/dist/2020.js';
import {Upstream} from '../dist/adapter/src/upstream.js';
import {validateUrl} from '../dist/upstream/build/src/utils/url.js';
import {McpResponse} from '../dist/upstream/build/src/McpResponse.js';

test('mapping accepts official extension-only and mixed page responses without granting worker targets',async()=>{
 const page=(id,targetId,url)=>({id,targetId,url:()=>url,getTitle:()=>targetId});
 const regular=page(1,'regular','https://example.test/');
 const extension=page(2,'extension','chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html');
 const unowned=page(3,'unowned','https://unowned.test/');
 for(const pages of [[regular],[extension],[regular,extension,unowned]]){
  const response=new McpResponse({categoryExtensions:true});response.setIncludePages(true);
  const context={getPages:()=>pages,getSelectedPageFallback:()=>undefined,getTargetInfos:async()=>new Map(),isPageSelected:()=>false,getWorkers:()=>{throw new Error('page responses must not enumerate unowned workers');}};
  const result=await response.format(context,{});
  const upstream=new Upstream('http://127.0.0.1:9222');
  upstream.call=async(name,args,scope)=>{assert.equal(name,'list_pages');assert.deepEqual(scope,pages.filter(p=>p!==unowned).map(p=>p.targetId));return result;};
  const owned=pages.filter(p=>p!==unowned);
  const mapping=await upstream.mapping(owned.map(p=>p.targetId));
  assert.deepEqual([...mapping],owned.map(p=>[p.targetId,p.id]));
  assert.equal(result.structuredContent.extensionServiceWorkers,undefined);
  assert.doesNotMatch(result.content[0].text,/Extension Service Workers/);
  if(pages.length===1&&pages[0]===extension)assert.equal(result.structuredContent.pages,undefined);
 }
});

test('official extension navigation remains gated by its category option',()=>{
 const url='chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html';
 assert.throws(()=>validateUrl(url,{}),/without --categoryExtensions/);
 assert.equal(validateUrl(url,{categoryExtensions:true}).href,url);
 assert.throws(()=>validateUrl('chrome://settings',{categoryExtensions:true}),/not allowed/);
});

test('pinned official MCP schemas compile and expose only owned-page parameters',async()=>{
 const upstream=new Upstream('http://127.0.0.1:9222');
 try {
  const tools=await upstream.tools(),ajv=new Ajv2020({strict:false});assert.equal(tools.length,19);
  await upstream.addRoot('/tmp'); // New stdio clients must be able to register roots after startup.
  for(const tool of tools){
   const validate=ajv.compile(tool.inputSchema);
   for(const field of ['__cbwTargetIds','__cbwDeadline','sourcePath','filePath','serviceWorkerId']){
    assert.equal(tool.inputSchema.properties[field],undefined,tool.name+' exposes '+field);
    assert.ok(!tool.inputSchema.required?.includes(field));
   }
   assert.equal(tool.inputSchema.properties.pageId.type,'string');
   assert.equal(validate({pageId:3}),false,'numeric upstream IDs must never be public');
  }
 }finally{await upstream.close();}
});

test('empty official page list waits for discovery without rejecting a new target',async()=>{
 const upstream=new Upstream('http://127.0.0.1:9222');let calls=0;
 upstream.call=async()=>({structuredContent:++calls===1?{}:{pages:[{id:7,targetId:'owned'}]}});
 assert.equal((await upstream.mapping(['owned'])).get('owned'),7);assert.equal(calls,2);
 upstream.call=async()=>({structuredContent:{pages:'invalid'}});
 await assert.rejects(upstream.mapping(['owned']),/UPSTREAM_CONTRACT_CHANGED/);
});

test('read timeout drains the exact page before releasing, without replaying the operation',async()=>{
 const u=new Upstream('http://127.0.0.1:9222'),calls=[];let finish;
 const terminal=new Promise(resolve=>finish=resolve);
 u.client={async callTool(request){calls.push(request);if(calls.length===1)throw Object.assign(new Error('timeout'),{code:-32001});await terminal;return {content:[]};}};
 let settled=false;
 const result=u.call('wait_for',{pageId:7,text:['absent'],timeout:25000},['owned']).catch(e=>{settled=true;return e;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
 assert.equal(calls.length,2);assert.equal(calls[0].arguments.timeout,24000);
 assert.equal(calls[1].name,'take_snapshot');assert.equal(calls[1].arguments.pageId,7);
 assert.deepEqual(calls[1].arguments.__cbwTargetIds,['owned']);
 finish();const error=await result;assert.equal(error.details.outcome,'FAILED');assert.equal(error.details.terminalEvidence,'same_page_snapshot_completed');
});

test('failed read drain and arbitrary JavaScript or writes retain unknown outcome',async()=>{
 for(const name of ['wait_for','click','evaluate_script']){
  const u=new Upstream('http://127.0.0.1:9222');let calls=0;
  u.client={async callTool(){calls++;throw Object.assign(new Error('timeout'),{code:-32001});}};
  await assert.rejects(u.call(name,{pageId:7},['owned']),e=>e.details.outcome==='UNKNOWN');
  assert.equal(calls,name==='wait_for'?2:1);
 }
});
