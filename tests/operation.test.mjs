import test from 'node:test';
import assert from 'node:assert/strict';
import {operations,bounded,dispatched,errorDetails} from '../dist/adapter/src/operation.js';
test('abort from a socket callback preserves the captured in-flight outcome',async()=>{
 const controller=new AbortController();let complete;
 const pending=new Promise(r=>complete=r);
 const result=operations.run({id:'inflight',signal:controller.signal,deadline:Date.now()+1000},()=>{dispatched();return bounded(pending,controller.signal);});
 // The signal is delivered outside AsyncLocalStorage, as real socket events are.
 controller.abort();await assert.rejects(result,e=>e.details.outcome==='UNKNOWN'&&e.details.requestId==='inflight');complete();
});
test('not-started cancellation is distinct from an operation already dispatched',async()=>{
 const controller=new AbortController();const result=operations.run({id:'queued',signal:controller.signal,deadline:Date.now()+1000},()=>bounded(new Promise(()=>{}),controller.signal));controller.abort();
 await assert.rejects(result,e=>e.details.outcome==='NOT_STARTED');
 assert.equal(errorDetails(Error('UNEXPECTED_FAILURE')).outcome,'UNKNOWN');
});
