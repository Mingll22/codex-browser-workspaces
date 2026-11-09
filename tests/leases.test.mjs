import test from 'node:test';
import assert from 'node:assert/strict';
import {PageLeases,LEASE_MS} from '../dist/adapter/src/leases.js';

function setup(){let time=1000;return {leases:new PageLeases(()=>time),advance:ms=>time+=ms,now:()=>time};}

test('listing is read-only; expiry includes the exact five-minute boundary',()=>{
 const {leases,advance,now}=setup();assert.equal(LEASE_MS,5*60*1000);
 assert.deepEqual(leases.view('root/page','a'),{visible:true,version:1,status:'AVAILABLE'});assert.deepEqual(leases.snapshot(),{});
 const token=leases.begin('root/page','a',1);leases.finish(token);const expiry=now()+LEASE_MS;
 advance(LEASE_MS-1);assert.equal(leases.view('root/page','a').expiresAt,expiry);assert.equal(leases.view('root/page','b').visible,false);
 advance(1);assert.deepEqual(leases.view('root/page','b'),{visible:true,version:2,status:'AVAILABLE'});
 assert.throws(()=>leases.begin('root/page','a',1),/PAGE_LEASE_EXPIRED/);
});

test('operations renew a lease while views leave its expiry unchanged',()=>{
 const {leases,advance,now}=setup();const first=leases.begin('root/page','a',1);leases.finish(first);advance(LEASE_MS-1);
 const renewed=leases.begin('root/page','a',1);leases.finish(renewed);const expiry=now()+LEASE_MS;
 advance(1);assert.equal(leases.view('root/page','a').expiresAt,expiry);assert.equal(leases.view('root/page','b').visible,false);
 advance(LEASE_MS-1);assert.equal(leases.view('root/page','b').status,'AVAILABLE');
});

test('the first claim wins and a sibling cannot claim the same version',()=>{
 const {leases}=setup();const first=leases.begin('root/page','a',1);
 assert.throws(()=>leases.begin('root/page','b',1),error=>error.message==='PAGE_LEASE_BUSY'&&error.details.outcome==='NOT_STARTED');
 leases.finish(first);assert.equal(leases.view('root/page','b').visible,false);
});

test('release requires its current owner and version and advances the next lease version',()=>{
 const {leases}=setup();const first=leases.begin('root/page','a',1);
 assert.throws(()=>leases.release('root/page','a',1),/PAGE_OPERATION_IN_PROGRESS/);leases.finish(first);
 assert.throws(()=>leases.release('root/page','b',1),/PAGE_LEASE_BUSY/);assert.throws(()=>leases.release('root/page','a',0),/PAGE_LEASE_EXPIRED/);
 leases.release('root/page','a',1);assert.equal(leases.view('root/page','b').version,2);
 const second=leases.begin('root/page','b',2);leases.finish(second);assert.equal(leases.view('root/page','a').visible,false);
});

test('executing work remains exclusive past expiry until every operation finishes',()=>{
 const {leases,advance}=setup();const first=leases.begin('root/page','a',1),second=leases.begin('root/page','a',1);advance(LEASE_MS*10);
 assert.equal(leases.view('root/page','b').visible,false);assert.equal(leases.held('root/page'),true);
 leases.finish(first);assert.equal(leases.view('root/page','b').visible,false);assert.throws(()=>leases.release('root/page','a',1),/PAGE_OPERATION_IN_PROGRESS/);
 leases.finish(second);assert.equal(leases.view('root/page','b').status,'AVAILABLE');assert.equal(leases.held('root/page'),false);
});

test('unknown outcomes block release and takeover despite expiry',()=>{
 const {leases,advance}=setup();const token=leases.begin('root/page','a',1);leases.finish(token,true);advance(LEASE_MS*100);
 assert.equal(leases.view('root/page','a').status,'UNKNOWN');assert.equal(leases.view('root/page','b').visible,false);
 assert.throws(()=>leases.begin('root/page','a',1),error=>error.message==='PAGE_EXECUTION_UNKNOWN'&&error.details.outcome==='UNKNOWN');
 assert.throws(()=>leases.begin('root/page','b',1),/PAGE_EXECUTION_UNKNOWN/);assert.throws(()=>leases.release('root/page','a',1),/PAGE_EXECUTION_UNKNOWN/);
 assert.equal(leases.held('root/page'),true);
});

test('a stale token cannot validate or finish the next owner lease',()=>{
 const {leases}=setup();const first=leases.begin('root/page','a',1);leases.finish(first);leases.release('root/page','a',1);
 const second=leases.begin('root/page','b',2);assert.throws(()=>leases.validate(first),/PAGE_REFERENCE_EXPIRED/);
 leases.finish(first,true);assert.equal(leases.view('root/page','b').status,'OWNED');assert.throws(()=>leases.release('root/page','b',2),/PAGE_OPERATION_IN_PROGRESS/);
 leases.finish(second);leases.release('root/page','b',2);assert.equal(leases.held('root/page'),false);
});

test('reload marks persisted in-flight work unknown while expired idle leases remain available',()=>{
 const {leases,advance,now}=setup();leases.begin('root/busy','a',1);const idle=leases.begin('root/idle','a',1);leases.finish(idle);
 const persisted=JSON.parse(JSON.stringify(leases.snapshot()));advance(LEASE_MS);
 const restored=new PageLeases(now);restored.load(persisted);
 assert.equal(restored.view('root/busy','a').status,'UNKNOWN');assert.equal(restored.view('root/busy','b').visible,false);
 assert.equal(restored.view('root/idle','b').status,'AVAILABLE');assert.throws(()=>restored.release('root/busy','a',1),/PAGE_EXECUTION_UNKNOWN/);
});

test('membership invalidation preserves running work and advances the target lease version after completion',()=>{
 const {leases}=setup();const first=leases.begin('g1/target','a',1);leases.invalidate('g1/target');
 assert.equal(leases.held('g1/target'),true);assert.equal(leases.view('g1/target','b').visible,false);
 assert.throws(()=>leases.begin('g1/target','a',1),/PAGE_OPERATION_IN_PROGRESS/);
 leases.finish(first);assert.equal(leases.held('g1/target'),false);assert.equal(leases.view('g1/target','b').version,2);
 const second=leases.begin('g1/target','b',2);assert.throws(()=>leases.validate(first),/PAGE_REFERENCE_EXPIRED/);leases.finish(second);
});

test('membership invalidation cannot erase an unknown target outcome',()=>{
 const {leases}=setup();const first=leases.begin('g1/target','a',1);leases.finish(first,true);leases.invalidate('g1/target');
 assert.equal(leases.held('g1/target'),true);assert.equal(leases.view('g1/target','a').status,'UNKNOWN');assert.equal(leases.view('g1/target','b').visible,false);
 assert.throws(()=>leases.begin('g1/target','b',1),/PAGE_EXECUTION_UNKNOWN/);
});

test('successful membership handoff preserves the executing grant even after a list observed the move',()=>{
 const {leases,advance,now}=setup(),key='g1/target';leases.bind(key,'root/old');
 const old=leases.begin(key,'a',1);leases.finish(old);leases.invalidate(key);
 const moving=leases.begin(key,'a',2);leases.bind(key,'root/new');advance(LEASE_MS*2);
 assert.throws(()=>leases.begin(key,'b',2),/PAGE_OPERATION_IN_PROGRESS/);
 leases.rebind(moving,'root/new');assert.equal(leases.snapshot()[key].executing,1);
 assert.equal(leases.view(key,'a').expiresAt,now()+LEASE_MS);assert.equal(leases.view(key,'b').visible,false);
 leases.finish(moving);const next=leases.begin(key,'a',2);leases.finish(next);
 assert.throws(()=>leases.begin(key,'a',1),/PAGE_LEASE_EXPIRED/);
 // Ordinary membership observation still revokes an idle grant.
 leases.bind(key,'other/new');assert.equal(leases.view(key,'b').status,'AVAILABLE');
});

test('membership handoff cannot revive finished or stale grants or clear an unknown outcome',()=>{
 const {leases}=setup(),key='g1/target';leases.bind(key,'root/old');
 const old=leases.begin(key,'a',1);leases.finish(old);
 assert.throws(()=>leases.rebind(old,'root/new'),/PAGE_REFERENCE_EXPIRED/);
 leases.release(key,'a',1);const moving=leases.begin(key,'b',2);
 assert.throws(()=>leases.rebind(old,'root/new'),/PAGE_REFERENCE_EXPIRED/);
 leases.finish(moving,true);leases.bind(key,'other/new');
 assert.throws(()=>leases.rebind(moving,'other/new'),/PAGE_EXECUTION_UNKNOWN/);
 assert.equal(leases.view(key,'a').visible,false);assert.equal(leases.view(key,'b').status,'UNKNOWN');
});
