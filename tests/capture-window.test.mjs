import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PageSource,WorkspaceStatus} from '../dist/protocol/src/contracts.js';

async function setup({saved,upgrade,initialTabs=[],emitGroupEvents=false}={}){
 const tabs=new Map(initialTabs.map(t=>[t.id,{...t}])),windows=new Map(),groups=new Map(),updates=[];let next=100;
 let stored=saved,archive=upgrade,now=1_000_000,peer;const wire=[];
 const listeners={};
 const event={addListener(){}};
 const chrome={
  storage:{session:{async get(){return {state:stored};},async set({state}){stored=structuredClone(state);}},local:{async get(){return {workspaceUpgrade:archive};},async remove(){archive=undefined;}}},
  debugger:{async getTargets(){return [...tabs.values()].map(t=>({id:'target-'+t.id,tabId:t.id,type:'page'}));}},
  runtime:{getManifest:()=>({version:'test'})},alarms:{onAlarm:event,create(){}},
  tabs:{
   onCreated:event,onRemoved:{addListener(fn){listeners.removed=fn;}},onUpdated:{addListener(fn){listeners.updated=fn;}},
   async get(id){if(!tabs.has(id))throw new Error(`No tab with id: ${id}`);return {...tabs.get(id)};},
   async create(args){assert.ok(Number.isInteger(args.windowId));assert.equal(args.active,false);const t={id:++next,windowId:args.windowId,active:false,groupId:-1,url:args.url};tabs.set(t.id,t);return {...t};},
   async group({tabIds,groupId,createProperties}){if(groupId===undefined)assert.equal(createProperties?.windowId,tabs.get(tabIds).windowId);const id=groupId??++next;tabs.get(tabIds).groupId=id;if(!groups.has(id))groups.set(id,{id,windowId:tabs.get(tabIds).windowId,collapsed:false});if(emitGroupEvents)listeners.updated(tabIds,{groupId:id});return id;},
   async move(id,args){Object.assign(tabs.get(id),args,{groupId:-1});if(emitGroupEvents)listeners.updated(id,{groupId:-1});return {...tabs.get(id)};},
   async remove(id){const group=tabs.get(id)?.groupId;tabs.delete(id);if(![...tabs.values()].some(t=>t.groupId===group))groups.delete(group);},
   async query(query){return [...tabs.values()].filter(t=>Object.entries(query).every(([key,value])=>t[key]===value)).map(t=>({...t}));},
   async update(id,args){updates.push({id,args});for(const t of tabs.values())if(t.windowId===tabs.get(id).windowId)t.active=t.id===id;const group=groups.get(tabs.get(id).groupId);if(group)group.collapsed=false;return {...tabs.get(id)};},
  },
  tabGroups:{async query(){return [...groups.values()].map(g=>({...g}));},async update(id,args){Object.assign(groups.get(id),args);},async get(id){if(!groups.has(id))throw new Error(`No group with id: ${id}`);return {...groups.get(id)};}},
  windows:{
   async create(args){assert.equal(args.focused,false);assert.equal(args.url,'about:blank');const w={id:++next,state:'normal'};const tab={id:++next,windowId:w.id,active:true,groupId:-1,url:args.url};tabs.set(tab.id,tab);windows.set(w.id,w);return {...w,tabs:[{...tab}]};},
   async getAll(){return [...windows.values()].map(w=>({...w}));},async get(id){return {type:'normal',incognito:false,...windows.get(id)};},
   async getLastFocused(){return {...[...windows.values()][0]};},
   async update(id,args){assert.equal(args.focused,false);Object.assign(windows.get(id),args);return {...windows.get(id)};},
  },
 };
 const context=vm.createContext({PageSource,WorkspaceStatus,chrome,crypto:{randomUUID},console,Date:{now:()=>now},config:{url:'ws://127.0.0.1:1',token:'test'},WebSocket:class {readyState=0;constructor(){peer=this;}send(payload){wire.push(JSON.parse(payload));}},setTimeout,clearTimeout});
 const source=readFileSync('packages/extension/worker.js','utf8').replace(/^import .*;$/gm,'').replace("import {PageSource,WorkspaceStatus} from './contracts.js';",'');
 vm.runInContext(source+'\nglobalThis.testReady=ready;globalThis.testHandle=handle;',context);await context.testReady;
 return {chrome,tabs,windows,groups,updates,hello:()=>{peer.onopen();return wire.find(message=>message.type==='hello');},emitUpdated:(id,groupId)=>listeners.updated(id,{groupId}),emitRemoved:id=>listeners.removed(id),enqueue:fn=>vm.runInContext("enqueue",context)(fn),drain:()=>vm.runInContext('queue',context),advance:ms=>now+=ms,call:(method,args)=>context.testHandle(method,args),callWithRequest:(method,args,request)=>context.testHandle(method,args,request),stored:()=>stored,archive:()=>archive};
}
const open=(call,threadId,slot='main')=>call('open',{threadId,slot,maxTabs:8,title:'Same title'});
test('a pending Chrome close releases the queue without falsely revoking ownership',async()=>{
 const {call,callWithRequest,enqueue,chrome}=await setup();
 const a=(await open(call,'A')).page;await open(call,'B');
 const remove=chrome.tabs.remove;let finish;
 chrome.tabs.remove=id=>new Promise(resolve=>{finish=async()=>{await remove(id);resolve();};});
 const closing=enqueue(()=>callWithRequest('close',{threadId:'A',tabId:a.tabId,targetId:a.targetId},{deadline:1000020,cancelled:false,dispatched:false}));
 const other=enqueue(()=>call('list',{threadId:'B'}));
 await assert.rejects(closing,error=>error.message==='PAGE_CLOSE_PENDING'&&error.details.outcome==='UNKNOWN');
 assert.equal((await other).pages.length,1);assert.equal((await call('list',{threadId:'A'})).pages.length,1);
 await finish();assert.equal((await call('list',{threadId:'A'})).pages.length,0);
});
test('threads share one unfocused window with distinct groups and stable colorful slots',async()=>{
 const {call,windows,groups}=await setup();const a=await open(call,'A');const ref=await open(call,'A','reference');const b=await open(call,'B');
 assert.equal(a.page.windowId,b.page.windowId);assert.equal(a.page.windowId,ref.page.windowId);assert.equal(a.page.groupId,ref.page.groupId);assert.notEqual(a.page.groupId,b.page.groupId);assert.equal(windows.size,1);
 const color=groups.get(a.page.groupId).color;assert.notEqual(color,'grey');assert.notEqual(color,groups.get(b.page.groupId).color);
 const reused=await open(call,'A');assert.equal(reused.page.tabId,a.page.tabId);assert.equal(reused.reused,true);
 await call('title',{threadId:'A',title:'Changed title'});assert.equal(groups.get(a.page.groupId).color,color);assert.equal(windows.size,1);
 for(let i=0;i<10;i++)await open(call,'extra-'+i);assert.equal(windows.size,1);
});
test('capture restores the previous thread tab and collapsed target group',async()=>{
 const {call,tabs,groups}=await setup();const a=(await open(call,'A')).page;const b=(await open(call,'B')).page;
 groups.get(b.groupId).collapsed=true;
 const lease=await call('prepare_capture',{threadId:'B',tabId:b.tabId,targetId:b.targetId});assert.equal(tabs.get(b.tabId).active,true);
 await assert.rejects(call('finish_capture',{threadId:'A',token:lease.token}),/CAPTURE_NOT_OWNED/);
 await call('finish_capture',{threadId:'B',token:lease.token});assert.equal(tabs.get(a.tabId).active,true);assert.equal(groups.get(b.groupId).collapsed,true);
});
test('capture does not override manual tab selection or allow an overlapping capture',async()=>{
 const {call,tabs}=await setup();const a=(await open(call,'A')).page;const b=(await open(call,'B')).page;const ref=(await open(call,'A','reference')).page;
 const args={threadId:'B',tabId:b.tabId,targetId:b.targetId};const lease=await call('prepare_capture',args);
 await assert.rejects(call('prepare_capture',args),/CAPTURE_ALREADY_IN_PROGRESS/);
 tabs.get(b.tabId).active=false;tabs.get(ref.tabId).active=true;
 await call('finish_capture',{threadId:'B',token:lease.token});assert.equal(tabs.get(ref.tabId).active,true);assert.equal(tabs.get(a.tabId).active,false);
});
test('capture preserves minimized windows, restores ordinary user tabs and grants no page ownership',async()=>{
 const {call,tabs,windows,groups,updates,chrome}=await setup();const a=(await open(call,'A')).page;const args={threadId:'A',tabId:a.tabId,targetId:a.targetId};
 tabs.get(a.tabId).active=false;tabs.set(1000,{id:1000,windowId:a.windowId,groupId:-1,active:true});
 const lease=await call('prepare_capture',args);
 await call('finish_capture',{threadId:'A',token:lease.token});assert.equal(tabs.get(1000).active,true);
 windows.get(a.windowId).state='minimized';
 // Any window update (including focused:false restoration) would violate capture.
 chrome.windows.update=async()=>assert.fail('capture must not change OS window state or focus');
 const minimizedLease=await call('prepare_capture',args);assert.equal(windows.get(a.windowId).state,'minimized');
 await call('finish_capture',{threadId:'A',token:minimizedLease.token});assert.equal(tabs.get(1000).active,true);assert.equal(windows.get(a.windowId).state,'minimized');
 assert.equal((await call('list',{threadId:'A'})).pages.length,1);
 await assert.rejects(call('check',{threadId:'A',tabId:1000,targetId:'target-1000'}),/PAGE_NOT_OWNED/);
 await assert.rejects(call('prepare_capture',{...args,threadId:'B'}),/PAGE_NOT_OWNED/);
 windows.set(999,{id:999,state:'minimized'});tabs.get(a.tabId).windowId=999;groups.get(a.groupId).windowId=999;
 const moved=await call('prepare_capture',args);await call('finish_capture',{threadId:'A',token:moved.token});assert.equal(windows.get(999).state,'minimized');assert.equal(updates.length,5);
});
test('first visit binds to the existing default window and keeps it despite focus changes',async()=>{
 const {call,tabs,windows}=await setup();windows.set(7,{id:7,state:'normal'});tabs.set(70,{id:70,windowId:7,groupId:-1,active:true});
 const a=(await open(call,'A')).page;assert.equal(a.windowId,7);assert.equal(windows.size,1);
 windows.set(8,{id:8,state:'normal',focused:true});
 const b=(await open(call,'B')).page;assert.equal(b.windowId,7);assert.equal(windows.size,2);assert.equal(tabs.get(70).active,true);
});
test('closing one group preserves the shared window and the other group',async()=>{
 const {call,windows}=await setup();const a=(await open(call,'A')).page;const b=(await open(call,'B')).page;
 await call('close',{threadId:'A',tabId:a.tabId,targetId:a.targetId});const next=(await open(call,'A')).page;
 assert.equal(next.windowId,b.windowId);assert.notEqual(next.groupId,b.groupId);assert.equal(windows.size,1);
});
test('an unregistered user tab entering and leaving does not alter owned slot or group',async()=>{
 const {call,tabs,groups,emitUpdated,drain}=await setup();const a=(await open(call,'A')).page;
 tabs.set(1000,{id:1000,windowId:a.windowId,groupId:a.groupId,url:'https://example.org'});
 emitUpdated(1000,a.groupId);await drain();tabs.get(1000).groupId=-1;emitUpdated(1000,-1);await drain();
 const result=await open(call,'A');assert.equal(result.reused,true);assert.equal(result.page.tabId,a.tabId);assert.equal(groups.size,1);
 await assert.rejects(call('check',{threadId:'A',tabId:1000,targetId:'target-1000'}),/PAGE_NOT_OWNED/);
});
test('group with an incoming user page remains usable while the moved-out main slot is replaced',async()=>{
 const {call,tabs,groups,emitUpdated,drain}=await setup();const a=(await open(call,'A')).page;const b=(await open(call,'B')).page;
 tabs.set(1000,{id:1000,windowId:a.windowId,groupId:a.groupId,url:'https://example.org'});
 tabs.get(a.tabId).groupId=-1;emitUpdated(a.tabId,-1);await drain();
 const incoming=(await call('list',{threadId:'A'})).pages;assert.equal(incoming.length,1);assert.equal(incoming[0].tabId,1000);assert.equal(incoming[0].canClose,false);
 const result=await open(call,'A');assert.equal(result.reused,false);assert.equal(result.createdGroup,false);assert.equal(result.page.groupId,a.groupId);assert.equal(groups.size,2);
 assert.equal(tabs.get(a.tabId).groupId,-1);assert.equal(tabs.get(1000).groupId,a.groupId);
 assert.equal((await call('check',{threadId:'A',tabId:1000,targetId:'target-1000'})).page.canClose,false);
 for(const p of [a,b])await assert.rejects(call('check',{threadId:'A',tabId:p.tabId,targetId:p.targetId}),/PAGE_NOT_OWNED/);
});
test('queued departure invalidates the old membership even when the tab has returned',async()=>{
 const {call,tabs,emitUpdated,drain}=await setup();const a=(await open(call,'A')).page;
 tabs.get(a.tabId).groupId=-1;emitUpdated(a.tabId,-1);tabs.get(a.tabId).groupId=a.groupId;emitUpdated(a.tabId,a.groupId);await drain();
 const returned=(await call('check',{threadId:'A',tabId:a.tabId,targetId:a.targetId})).page;assert.notEqual(returned.membershipId,a.membershipId);assert.equal(returned.canClose,false);
 await assert.rejects(call('check',{threadId:'A',tabId:a.tabId,targetId:a.targetId,membershipId:a.membershipId}),/PAGE_NOT_OWNED/);
 const result=await open(call,'A');assert.equal(result.reused,false);assert.notEqual(result.page.tabId,a.tabId);
});
test('a confirmed departure invalidates old references but permits protected reentry',async()=>{
 const {call,tabs,emitUpdated,drain}=await setup();const a=(await open(call,'A')).page;
 tabs.get(a.tabId).groupId=-1;emitUpdated(a.tabId,-1);await drain();tabs.get(a.tabId).groupId=a.groupId;emitUpdated(a.tabId,a.groupId);await drain();
 await assert.rejects(call('check',{threadId:'A',tabId:a.tabId,targetId:a.targetId,membershipId:a.membershipId}),/PAGE_NOT_OWNED/);
 const returned=(await call('check',{threadId:'A',tabId:a.tabId,targetId:a.targetId})).page;assert.equal(returned.canClose,false);
 const result=await open(call,'A');assert.equal(result.page.groupId,a.groupId);assert.notEqual(result.page.tabId,a.tabId);assert.equal(result.createdGroup,false);
});
test('a surviving group moved across windows uses its real window when opening',async()=>{
 const {call,tabs,groups,windows}=await setup();const a=(await open(call,'A')).page;
 tabs.get(a.tabId).groupId=-1;tabs.set(1000,{id:1000,windowId:999,groupId:a.groupId});groups.get(a.groupId).windowId=999;windows.set(999,{id:999,state:'normal'});
 const count=tabs.size,result=await open(call,'A');assert.equal(tabs.size,count+1);assert.equal(result.page.windowId,999);assert.equal(result.page.groupId,a.groupId);assert.equal(result.createdGroup,false);
});
test('a deleted bound group creates a new group without adopting a same-named foreign group',async()=>{
 const {call,groups}=await setup();const a=(await open(call,'A')).page;const b=(await open(call,'B')).page;
 await call('close',{threadId:'A',tabId:a.tabId,targetId:a.targetId});assert.equal(groups.has(a.groupId),false);
 const result=await open(call,'A');assert.equal(result.createdGroup,true);assert.notEqual(result.page.groupId,a.groupId);assert.notEqual(result.page.groupId,b.groupId);
});
test('group lookup failure is surfaced without creating a replacement tab or group',async()=>{
 const {call,chrome,tabs,groups}=await setup();const a=(await open(call,'A')).page;tabs.get(a.tabId).groupId=-1;
 chrome.tabGroups.get=async()=>{throw Error('GROUP_QUERY_FAILED');};const count=tabs.size;
 await assert.rejects(open(call,'A'),/GROUP_QUERY_FAILED/);assert.equal(tabs.size,count);assert.equal(groups.size,1);
});
test('explicit upgrade preserves generation only when exact tab targets still exist',async()=>{
 const state={modelVersion:2,generation:'previous-generation',workspaces:{A:{groupId:2,windowId:1,tabs:{3:{slot:'main',retained:true}}}}};
 const receipt={tabId:3,targetId:'target-3',groupId:2,windowId:1};
 const fixture=await setup({upgrade:{state,targets:[receipt]},initialTabs:[{id:3,windowId:1,groupId:2}]});
 assert.equal(fixture.stored().generation,'previous-generation');assert.equal(fixture.stored().windowId,1);assert.equal(fixture.archive(),undefined);
 await assert.rejects(setup({upgrade:{state,targets:[{...receipt,targetId:'recycled-target'}]},initialTabs:[{id:3,windowId:1,groupId:2}]}),/WORKSPACE_UPGRADE_TARGET_CHANGED/);
});
test('successful open preserves all ordinary user blank pages regardless of their metadata',async()=>{
 const {call,tabs,windows}=await setup();windows.set(7,{id:7,state:'normal'});
 const add=(id,fields={})=>tabs.set(id,{id,windowId:7,groupId:-1,url:'chrome://newtab/',status:'complete',pinned:false,...fields});
 add(1);add(2,{url:'about:blank'});add(3,{pinned:true});add(4,{url:'https://example.org'});add(5,{groupId:99});
 add(6,{pendingUrl:'https://example.org/loading'});add(7,{status:'loading'});add(8,{openerTabId:4});add(9,{windowId:8});
 const a=(await open(call,'A')).page;const b=(await open(call,'B')).page;
 assert.ok(tabs.has(1));assert.ok(tabs.has(2));
 const result=await call('finalize_open',{threadId:'A',tabId:a.tabId,targetId:a.targetId});assert.equal(result.closedBlankTabs,0);
 assert.deepEqual([...tabs.keys()].sort((x,y)=>x-y),[1,2,3,4,5,6,7,8,9,a.tabId,b.tabId].sort((x,y)=>x-y));
 assert.equal((await call('list',{threadId:'A'})).pages[0].tabId,a.tabId);assert.equal((await call('list',{threadId:'B'})).pages[0].tabId,b.tabId);
});
test('finalize validates its success page without scanning or mutating external tabs',async()=>{
 const {call,chrome,tabs}=await setup();const a=(await open(call,'A')).page;const b=(await open(call,'B')).page;
 tabs.set(1,{id:1,windowId:a.windowId,groupId:-1,url:'about:blank',status:'complete'});
 await assert.rejects(call('finalize_open',{threadId:'A',tabId:b.tabId,targetId:b.targetId}),/PAGE_NOT_OWNED/);assert.ok(tabs.has(1));
 const get=chrome.tabs.get;chrome.tabs.get=async id=>{if(id===1)tabs.get(id).pendingUrl='https://example.org/navigation';return get(id);};
 assert.equal((await call('finalize_open',{threadId:'A',tabId:a.tabId,targetId:a.targetId})).closedBlankTabs,0);assert.ok(tabs.has(1));
 tabs.delete(a.tabId);await assert.rejects(call('finalize_open',{threadId:'A',tabId:a.tabId,targetId:a.targetId}),/PAGE_NOT_OWNED/);assert.ok(tabs.has(1));
});
test('elapsed time and new-group flags never enable automatic blank cleanup',async()=>{
 const {call,tabs,advance}=await setup();const a=(await open(call,'A')).page;
 const args={threadId:'A',tabId:a.tabId,targetId:a.targetId};
 await call('finalize_open',{...args,createdGroup:true});
 const blank=()=>tabs.set(1,{id:1,windowId:a.windowId,groupId:-1,url:'about:blank',status:'complete'});
 blank();advance(59_999);assert.equal((await call('finalize_open',args)).closedBlankTabs,0);assert.ok(tabs.has(1));
 advance(1);assert.equal((await call('finalize_open',args)).closedBlankTabs,0);assert.equal(tabs.has(1),true);
 blank();assert.equal((await call('finalize_open',{...args,createdGroup:true})).closedBlankTabs,0);assert.ok(tabs.has(1));
});
test('transient metadata read failure preserves ownership and later reads recover',async()=>{
 const f=await setup();const a=(await open(f.call,'A')).page;
 const query=f.chrome.tabs.query;f.chrome.tabs.query=async()=>{throw Error('transient API failure');};
 await assert.rejects(f.call('list',{threadId:'A'}),/transient/);
 assert.ok(f.stored().workspaces.A.tabs[a.tabId]);f.chrome.tabs.query=query;
 assert.equal((await f.call('list',{threadId:'A'})).pages[0].targetId,a.targetId);
});
test('storage failure in a tab event does not poison later requests',async()=>{
 const f=await setup();const a=(await open(f.call,'A')).page;
 const save=f.chrome.storage.session.set;f.chrome.storage.session.set=async()=>{throw Error('injected storage failure');};
 f.tabs.delete(a.tabId);f.emitRemoved(a.tabId);await f.drain();
 f.chrome.storage.session.set=save;
 const result=await f.enqueue(()=>f.call('list',{threadId:'A'}));assert.equal(result.pages.length,0);
 assert.equal(result.workspace.revoked[0].reason,'CLOSED');assert.equal(f.stored().workspaces.A.tabs[a.tabId],undefined);
 const reopened=await f.enqueue(()=>open(f.call,'A'));assert.notEqual(reopened.page.tabId,a.tabId);
});
test('unchanged reads and titles do not write storage or update the group',async()=>{
 const f=await setup();await open(f.call,'A');let writes=0,updates=0;
 const save=f.chrome.storage.session.set,update=f.chrome.tabGroups.update;
 f.chrome.storage.session.set=async v=>{writes++;return save(v);};f.chrome.tabGroups.update=async(...a)=>{updates++;return update(...a);};
 for(let n=0;n<10;n++){await f.call('list',{threadId:'A'});await f.call('title',{threadId:'A',title:'Same title'});}
 assert.equal(writes,0);assert.equal(updates,0);
});
test('queued cancellation and deadlines prevent creation, while in-flight cancellation cleans its new tab',async()=>{
 const f=await setup();let release;const gate=new Promise(r=>release=r);
 const first=f.enqueue(()=>gate);const request={cancelled:false,deadline:Infinity};
 // handle's request context is tested directly after waiting in the real queue.
 const source=readFileSync('packages/extension/worker.js','utf8');assert.ok(source.includes("m.type==='cancel'"));
 const second=f.enqueue(()=>f.callWithRequest('open',{threadId:'A',slot:'main',maxTabs:8,title:'A'},request));
 // The direct fixture wrapper below separately checks the browser mutation boundary.
 request.cancelled=true;release();await first;await assert.rejects(second,/REQUEST_CANCELLED/);assert.equal(f.tabs.size,0);await open(f.call,'A');request.cancelled=false;
 const before=f.tabs.size;
 const query=f.chrome.windows.getAll;f.chrome.windows.getAll=async()=>{request.cancelled=true;return query();};
 await assert.rejects(f.callWithRequest('open',{threadId:'B',slot:'main',maxTabs:8,title:'B'},request),/REQUEST_CANCELLED/);
 assert.equal(f.tabs.size,before);
 const create=f.chrome.tabs.create;request.cancelled=false;f.chrome.windows.getAll=query;
 f.chrome.tabs.create=async args=>{const tab=await create(args);request.cancelled=true;return tab;};
 await assert.rejects(f.callWithRequest('open',{threadId:'B',slot:'main',maxTabs:8,title:'B'},request),/REQUEST_CANCELLED/);
 assert.equal(f.tabs.size,before);
 await assert.rejects(f.callWithRequest('open',{threadId:'B'}, {deadline:0}),/REQUEST_TIMEOUT/);
});
test('cancellation during capture activation restores selection and releases the capture lease',async()=>{
 const f=await setup();const a=(await open(f.call,'A')).page,b=(await open(f.call,'B')).page;
 f.windows.get(a.windowId).state='minimized';
 const request={cancelled:false,deadline:Infinity},update=f.chrome.tabs.update;
 f.chrome.tabs.update=async(...args)=>{const result=await update(...args);request.cancelled=true;return result;};
 await assert.rejects(f.callWithRequest('prepare_capture',{threadId:'B',tabId:b.tabId,targetId:b.targetId},request),/REQUEST_CANCELLED/);
 assert.equal(f.tabs.get(a.tabId).active,true);f.chrome.tabs.update=update;
 const lease=await f.call('prepare_capture',{threadId:'B',tabId:b.tabId,targetId:b.targetId});await f.call('finish_capture',{threadId:'B',token:lease.token});
});
test('cross-window move keeps its newly established membership after delayed Chrome group events',async()=>{
 const f=await setup({emitGroupEvents:true});
 const owned=await f.enqueue(()=>open(f.call,'A'));await f.drain();
 f.windows.set(999,{id:999,type:'normal',state:'normal'});
 f.tabs.set(1000,{id:1000,windowId:999,groupId:77,active:true,url:'https://example.org/user'});
 const moved=await f.enqueue(()=>f.call('move_tab_to_workspace',{threadId:'A',tabId:1000,targetId:'target-1000',title:'A'}));
 await f.drain();
 const checked=await f.call('check',{threadId:'A',tabId:1000,targetId:'target-1000',membershipId:moved.page.membershipId});
 assert.equal(checked.page.membershipId,moved.page.membershipId);assert.equal(checked.page.groupId,owned.page.groupId);
 assert.equal(checked.page.windowId,owned.page.windowId);assert.equal(checked.page.canClose,false);
});
test('cancelled open rolls back its grouped new tab but preserves a tab moved by the user',async()=>{
 for(const movedAway of [false,true]){
  const f=await setup();await open(f.call,'A');const before=f.tabs.size,request={cancelled:false,deadline:Infinity};
  const group=f.chrome.tabs.group;
  f.chrome.tabs.group=async args=>{const id=await group(args);if(movedAway)f.tabs.get(args.tabIds).groupId=999;request.cancelled=true;return id;};
  await assert.rejects(f.callWithRequest('open',{threadId:'B',slot:'main',maxTabs:8,title:'B'},request),/REQUEST_CANCELLED/);
  assert.equal(f.tabs.size,before+(movedAway?1:0));
 }
});
test('legacy session state cannot service operations until explicit family migration',async()=>{
 const f=await setup({saved:{generation:'legacy',workspaces:{A:{groupId:2,windowId:1,tabs:{}}}}});
 assert.equal((await f.call('ping',{})).generation,'legacy');
 await assert.rejects(f.call('list',{threadId:'A'}),/WORKSPACE_FAMILY_MIGRATION_REQUIRED/);
});

test('bridge hello declares the page model independently of extension release version',async()=>{
 const f=await setup();const hello=f.hello();assert.equal(hello.version,'test');assert.equal(hello.pageModelVersion,2);
});
