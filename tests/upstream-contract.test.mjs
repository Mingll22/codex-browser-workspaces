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
