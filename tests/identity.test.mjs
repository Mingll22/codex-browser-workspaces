import test from 'node:test';
import assert from 'node:assert/strict';
import {threadIdentity,Controllers,threadTitle} from '../dist/adapter/src/identity.js';
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const meta=id=>({threadId:id,'x-codex-turn-metadata':{thread_id:id,codex_version:'0.162.1'}});
test('only verified per-call metadata supplies identity',()=>{
 assert.equal(threadIdentity(meta(a)),a);
 for(const value of [undefined,null,[],{}, {thread_id:a}, {threadId:a}, {...meta(a),threadId:'not-a-uuid'}, {...meta(a),'x-codex-turn-metadata':{thread_id:b,codex_version:'0.162.1'}}, {...meta(a),'x-codex-turn-metadata':'invalid'}, {...meta(a),'x-codex-turn-metadata':[]}])assert.throws(()=>threadIdentity(value),/THREAD_IDENTITY_UNAVAILABLE/);
});
test('CLI versions never decide ownership when the identity contract is valid',()=>{
 for(const version of ['0.162.1','0.163.0','1.0.0','0.200.0-alpha.1','other',undefined]) {
  const metadata=meta(a);
  if(version===undefined)delete metadata['x-codex-turn-metadata'].codex_version;
  else metadata['x-codex-turn-metadata'].codex_version=version;
  assert.equal(threadIdentity(metadata),a);
  metadata['x-codex-turn-metadata'].thread_id=b;
  assert.throws(()=>threadIdentity(metadata),/THREAD_IDENTITY_UNAVAILABLE/);
 }
});
test('exclusive controllers, switch releases old identity, reconnect resumes',()=>{
 const c=new Controllers();c.attach('one',a);assert.throws(()=>c.attach('two',a),/THREAD_ALREADY_ATTACHED/);
 c.attach('two',b);assert.throws(()=>c.attach('one',b),/THREAD_ALREADY_ATTACHED/);assert.equal(c.attached(a),true);
 c.detach('two');assert.equal(c.attach('one',b),a);assert.equal(c.attached(a),false);
 c.attach('two',a);c.detach('one');c.attach('three',b);assert.equal(c.attached(b),true);
});
test('missing title database gives ID-based display only',()=>assert.equal(threadTitle(a,'/nonexistent/cbw.db'),'Codex 11111111'));
