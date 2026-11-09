import test from 'node:test';
import assert from 'node:assert/strict';
import {Ajv2020} from 'ajv/dist/2020.js';
import {Upstream} from '../dist/adapter/src/upstream.js';

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
