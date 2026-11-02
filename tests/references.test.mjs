import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeRef,decodeRef,inputReferences,outputReferences} from '../dist/adapter/src/references.js';
test('element, request and console references cannot cross page or upstream generation',()=>{
 for(const [kind,raw] of [['uid','3_5'],['reqid',3],['msgid',7]]){
  const value=encodeRef('page-a','epoch-1',kind,raw);
  assert.equal(decodeRef(value,'page-a','epoch-1',kind),raw);
  assert.throws(()=>decodeRef(value,'page-b','epoch-1',kind),/PAGE_NOT_OWNED/);
  assert.throws(()=>decodeRef(value,'page-a','epoch-2',kind),/REFERENCE_EXPIRED/);
  assert.throws(()=>decodeRef(String(raw),'page-a','epoch-1',kind),/PAGE_NOT_OWNED/);
 }
});
test('nested form fields, drag endpoints, and script element arguments are checked',()=>{
 const own=encodeRef('a','v','uid','1_1');const foreign=encodeRef('b','v','uid','2_1');
 assert.deepEqual(inputReferences({elements:[{uid:own,value:'x'}],args:[own],from_uid:own,to_uid:own},'a','v'),{elements:[{uid:'1_1',value:'x'}],args:['1_1'],from_uid:'1_1',to_uid:'1_1'});
 for(const value of [{elements:[{uid:foreign}]},{args:[foreign]},{from_uid:own,to_uid:foreign}])assert.throws(()=>inputReferences(value,'a','v'),/PAGE_NOT_OWNED/);
});
test('formatted reference output has page/epoch binding; unadapted structured IDs are not exposed',()=>{
 const out=outputReferences({content:[{type:'text',text:'uid=1_0 root\n  uid=1_1 button\nreqid=3 GET /\nmsgid=7 [log]\n9: about:blank'}],structuredContent:{pages:[{id:9}]}},'a','v',9);
 assert.equal(out.structuredContent,undefined);assert.match(out.content[0].text,/uid=a@v@uid@1_1/);assert.match(out.content[0].text,/reqid=a@v@reqid@3/);assert.match(out.content[0].text,/a: about:blank/);
});
