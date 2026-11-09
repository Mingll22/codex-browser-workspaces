import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {badgeForStatus,StatusError} from '../packages/extension/status.js';
import {PageSource,WorkspaceStatus} from '../dist/protocol/src/contracts.js';

async function fixture({toolbar=false}={}){
 const tabs=new Map(),groups=new Map(),windows=new Map([[1,{id:1,type:'normal',incognito:false,focused:false,state:'minimized'}],[2,{id:2,type:'normal',incognito:false,focused:false}]]);
 const calls=[],listeners={};let nextTab=10,nextGroup=20;
 const listener=name=>({addListener(fn){listeners[name]=fn;}});
 const copy=value=>structuredClone(value);
 const getTab=id=>{if(!tabs.has(id))throw new Error(`No tab with id: ${id}`);return copy(tabs.get(id));};
 const chrome={
  storage:{session:{get:async()=>({}),set:async()=>{}},local:{get:async()=>({}),remove:async()=>{}}},
  runtime:{id:'test-extension',getManifest:()=>({version:'0.4.0'}),onMessage:listener('runtimeMessage'),onConnect:listener('runtimeConnect'),sendMessage:async()=>{}},
  debugger:{getTargets:async()=>[...tabs.values()].map(tab=>({id:tab.targetId,tabId:tab.id,type:'page'}))},
  alarms:{create(){},onAlarm:listener('alarm')},
  tabs:{onCreated:listener('created'),onRemoved:listener('removed'),onUpdated:listener('updated'),
   get:async id=>{calls.push(['get',id]);return getTab(id);},
   query:async query=>{calls.push(['query',copy(query)]);return [...tabs.values()].filter(t=>Object.entries(query).every(([key,value])=>t[key]===value)).map(copy);},
   create:async options=>{calls.push(['create',copy(options)]);return add({...options});},
   update:async(id,change)=>{calls.push(['update',id,copy(change)]);const tab=tabs.get(id);if(change.active)for(const t of tabs.values())if(t.windowId===tab.windowId)t.active=false;Object.assign(tab,change);return copy(tab);},
   group:async options=>{calls.push(['group',copy(options)]);const id=options.groupId??nextGroup++;if(!groups.has(id))groups.set(id,{id,windowId:options.createProperties.windowId,title:'',color:'grey',collapsed:false});for(const tabId of [options.tabIds].flat())tabs.get(tabId).groupId=id;return id;},
   move:async(id,options)=>{calls.push(['move',id,copy(options)]);Object.assign(tabs.get(id),options,{groupId:-1});return getTab(id);},
   remove:async id=>{calls.push(['remove',id]);tabs.delete(id);},
  },
  tabGroups:{get:async id=>{if(!groups.has(id))throw new Error(`No group with id: ${id}`);return copy(groups.get(id));},update:async(id,change)=>{calls.push(['groupUpdate',id,copy(change)]);Object.assign(groups.get(id),change);return copy(groups.get(id));}},
  windows:{get:async id=>copy(windows.get(id)),getLastFocused:async()=>copy(windows.get(1)),getAll:async()=>[...windows.values()].map(copy),create:async()=>{throw new Error('unexpected new window');}}
 };
 function add(options={}){const id=nextTab++;const tab={id,windowId:1,groupId:-1,index:id,title:`Tab ${id}`,url:`https://site.test/${id}`,active:false,targetId:`target-${id}`,...options};tabs.set(id,tab);return copy(tab);}
 const badges=[];if(toolbar)chrome.action={setBadgeText:async value=>badges.push(value),setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}};
 const context=vm.createContext({badgeForStatus,StatusError,PageSource,WorkspaceStatus,chrome,crypto:{randomUUID},console:{error(){}},setTimeout,clearTimeout,WebSocket:class {static OPEN=1;readyState=0;constructor(){}},config:{url:'ws://test',token:'test'}});
 vm.runInContext(readFileSync('packages/extension/worker.js','utf8').replace(/^import .*;$/gm,'')+'\nglobalThis.testAPI={ready,status:uiStatus,receiveStatus,setSocketOpen:()=>{socket.readyState=1;},handle:(m,a)=>enqueue(()=>handle(m,a)),drain:()=>queue,state:()=>state};',context);
 await context.testAPI.ready;
 return {chrome,tabs,groups,windows,calls,badges,add,listeners,api:context.testAPI,call:async(method,args={})=>copy(await context.testAPI.handle(method,args)),open:async(threadId='root',slot='main')=>copy(await context.testAPI.handle('open',{threadId,slot,maxTabs:8,title:threadId,allowedTargetIds:[...tabs.values()].map(t=>t.targetId)}))};
}

test('real group membership discovers manual tabs without events and follows order, title and activation',async()=>{
 const f=await fixture(),opened=await f.open();const manual=f.add({groupId:opened.page.groupId,index:0,active:true,title:'User page'});
 const result=await f.call('list',{threadId:'root'});
 assert.deepEqual(result.pages.map(p=>p.tabId),[manual.id,opened.page.tabId]);
 assert.deepEqual(result.pages.map(p=>p.position),[1,2]);
 assert.equal(result.pages[0].title,'User page');assert.equal(result.pages[0].active,true);
 assert.equal(result.pages[0].source,'external');assert.equal(result.pages[0].canClose,false);assert.equal(result.pages[0].slot,null);
 assert.ok(result.pages.every(p=>!Object.hasOwn(p,'index')));
 assert.ok(f.calls.filter(c=>c[0]==='query').every(c=>Object.keys(c[1]).length));
 f.tabs.get(manual.id).groupId=-1;
 assert.deepEqual((await f.call('list',{threadId:'root'})).pages.map(p=>p.tabId),[opened.page.tabId]);
});

test('check validates only requested tab and protection survives leaving and returning',async()=>{
 const f=await fixture(),opened=await f.open(),tab=f.add({groupId:opened.page.groupId});
 const page=(await f.call('list',{threadId:'root'})).pages.find(p=>p.tabId===tab.id);
 f.calls.length=0;await f.call('check',{threadId:'root',...page});assert.deepEqual(f.calls,[['get',tab.id]]);
 await assert.rejects(f.call('close',{threadId:'root',...page}),/PAGE_CLOSE_PROTECTED/);
 f.tabs.get(tab.id).groupId=-1;await f.call('list',{threadId:'root'});f.tabs.get(tab.id).groupId=opened.page.groupId;
 const returned=(await f.call('list',{threadId:'root'})).pages.find(p=>p.tabId===tab.id);
 assert.notEqual(returned.membershipId,page.membershipId);assert.equal(returned.canClose,false);
 await assert.rejects(f.call('check',{threadId:'root',...page}),/PAGE_NOT_OWNED/);
});

test('event transition invalidates old membership even when tab already returned',async()=>{
 const f=await fixture(),{page}=await f.open();
 f.listeners.updated(page.tabId,{groupId:-1});await f.api.drain();
 const current=(await f.call('list',{threadId:'root'})).pages[0];assert.notEqual(current.membershipId,page.membershipId);
});

test('active metadata is scoped to last ordinary window and move preserves original object',async()=>{
 const f=await fixture(),tab=f.add({active:true});f.add({windowId:2,active:true});
 const active=await f.call('get_active_tab');assert.equal(active.page.targetId,tab.targetId);
 assert.deepEqual(f.calls.filter(c=>c[0]==='query'),[['query',{windowId:1,active:true}]]);
 const moved=await f.call('move_tab_to_workspace',{threadId:'root',tabId:tab.id,targetId:tab.targetId,title:'Workspace'});
 assert.equal(moved.page.tabId,tab.id);assert.equal(moved.page.url,tab.url);assert.equal(moved.page.canClose,false);assert.equal(moved.page.slot,null);assert.equal(moved.page.active,true);
 assert.equal(f.calls.filter(c=>c[0]==='create').length,0);
 const opened=await f.open();assert.notEqual(opened.page.tabId,tab.id);assert.equal(f.tabs.get(tab.id).url,tab.url);
});

test('move refuses another managed group and does not change user colors',async()=>{
 const f=await fixture(),one=await f.open('one'),two=await f.open('two');
 await assert.rejects(f.call('move_tab_to_workspace',{threadId:'two',...one.page,title:'Two'}),/PAGE_IN_ANOTHER_WORKSPACE/);
 f.groups.get(two.page.groupId).color='red';await f.call('title',{threadId:'two',title:'Renamed'});assert.equal(f.groups.get(two.page.groupId).color,'red');
});

test('busy named slot is rejected and external main cannot be reused',async()=>{
 const f=await fixture(),{page}=await f.open();
 await assert.rejects(f.call('open',{threadId:'root',slot:'main',maxTabs:8,title:'Root',allowedTargetIds:[]}),/PAGE_LEASE_BUSY/);
 assert.equal(f.tabs.size,1);assert.equal((await f.open()).page.tabId,page.tabId);
});

test('empty workspace is not recreated by list, check, title or group removal',async()=>{
 const f=await fixture(),{page}=await f.open();f.tabs.get(page.tabId).groupId=-1;f.groups.delete(page.groupId);
 const before=f.calls.filter(c=>c[0]==='create').length;
 assert.equal((await f.call('list',{threadId:'root'})).pages.length,0);
 await f.call('title',{threadId:'root',title:'Empty'});
 await assert.rejects(f.call('check',{threadId:'root',...page}),/PAGE_NOT_OWNED/);
 assert.equal(f.tabs.size,1);assert.equal(f.calls.filter(c=>c[0]==='create').length,before);
});

test('whole-group move changes window binding and screenshot selection restores without focus',async()=>{
 const f=await fixture(),{page}=await f.open();f.groups.get(page.groupId).windowId=2;f.tabs.get(page.tabId).windowId=2;
 const previous=f.add({windowId:2,active:true});const next=await f.open('root','second');assert.equal(next.page.windowId,2);
 const capture=await f.call('prepare_capture',{threadId:'root',...page});assert.equal(f.tabs.get(page.tabId).active,true);
 await f.call('finish_capture',{threadId:'root',token:capture.token});assert.equal(f.tabs.get(previous.id).active,true);
 assert.equal(f.windows.get(1).state,'minimized');assert.ok(f.calls.filter(c=>c[0]==='update').every(c=>!('focused' in c[2])));
});

test('successful remove promise still requires observed disappearance',async()=>{
 const f=await fixture(),{page}=await f.open();
 f.chrome.tabs.remove=async()=>{};
 await assert.rejects(f.call('close',{threadId:'root',...page}),/PAGE_CLOSE_PENDING/);
 assert.equal((await f.call('list',{threadId:'root'})).pages.length,1);
});

test('popup limit never removes or hides a manually grouped incoming page',async()=>{
 const f=await fixture(),{page}=await f.open(),external=f.add({groupId:page.groupId});
 const state=f.api.state();state.workspaces.root.maxTabs=1;
 state.pendingPopups[external.id]={tabId:external.id,targetId:external.targetId,initialGroupId:page.groupId};
 await f.call('adopt_popup',{generation:state.generation,tabId:external.id,targetId:external.targetId,openerTargetId:page.targetId});
 const listed=(await f.call('list',{threadId:'root'})).pages;
 assert.equal(listed.length,2);assert.equal(listed.find(p=>p.tabId===external.id).canClose,false);
 assert.equal(f.calls.filter(c=>c[0]==='remove').length,0);
});

test('actual opener popup can be adopted and true overflow popup can be closed',async()=>{
 const f=await fixture(),{page}=await f.open(),popup=f.add();const state=f.api.state();
 state.pendingPopups[popup.id]={tabId:popup.id,targetId:popup.targetId,initialGroupId:-1};
 await f.call('adopt_popup',{generation:state.generation,tabId:popup.id,targetId:popup.targetId,openerTargetId:page.targetId});
 assert.equal((await f.call('list',{threadId:'root'})).pages.find(p=>p.tabId===popup.id).source,'popup');
 state.workspaces.root.maxTabs=2;const overflow=f.add();
 state.pendingPopups[overflow.id]={tabId:overflow.id,targetId:overflow.targetId,initialGroupId:-1};
 await f.call('adopt_popup',{generation:state.generation,tabId:overflow.id,targetId:overflow.targetId,openerTargetId:page.targetId});
 assert.equal(f.tabs.has(overflow.id),false);
});

test('capture finish respects manual active selection and finalize never cleans user blank tabs',async()=>{
 const f=await fixture(),blank=f.add({url:'about:blank',active:true}),{page}=await f.open(),manual=f.add();
 await f.call('finalize_open',{threadId:'root',...page,createdGroup:true});assert.equal(f.tabs.has(blank.id),true);
 const capture=await f.call('prepare_capture',{threadId:'root',...page});await f.chrome.tabs.update(manual.id,{active:true});
 await f.call('finish_capture',{threadId:'root',token:capture.token});assert.equal(f.tabs.get(manual.id).active,true);
});

test('cross-group manual membership transfer revokes old access and protects new member',async()=>{
 const f=await fixture(),one=await f.open('one'),two=await f.open('two');
 f.tabs.get(one.page.tabId).groupId=two.page.groupId;
 assert.equal((await f.call('list',{threadId:'one'})).pages.length,0);
 const added=(await f.call('list',{threadId:'two'})).pages.find(p=>p.tabId===one.page.tabId);
 assert.equal(added.canClose,false);assert.notEqual(added.membershipId,one.page.membershipId);
 await assert.rejects(f.call('close',{threadId:'two',...added}),/PAGE_CLOSE_PROTECTED/);
});

test('external protection survives removal of source group and later explicit move',async()=>{
 const f=await fixture(),external=f.add();
 const first=await f.call('move_tab_to_workspace',{threadId:'root',tabId:external.id,targetId:external.targetId,title:'Root'});
 f.tabs.get(external.id).groupId=-1;f.groups.delete(first.page.groupId);await f.call('list',{threadId:'root'});
 const second=await f.call('move_tab_to_workspace',{threadId:'root',tabId:external.id,targetId:external.targetId,title:'Root'});
 assert.equal(second.page.canClose,false);assert.equal(second.page.targetId,first.page.targetId);
 assert.notEqual(second.page.membershipId,first.page.membershipId);
});

test('broker badge updates do not scan groups while popup is closed; popup counts real membership',async()=>{
 const f=await fixture({toolbar:true}),{page}=await f.open();f.add({groupId:page.groupId});f.calls.length=0;f.api.setSocketOpen();
 await f.api.receiveStatus({observedAt:Date.now(),brokerVersion:'0.4.0',mcpConnections:3,activeThreads:2,leasedTargets:[{targetId:page.targetId,expiresAt:Date.now()+300000,executing:0,unknown:false}]});
 assert.equal(f.badges.at(-1).text,'3');assert.equal(f.calls.some(call=>call[0]==='query'),false);
 const result=await f.api.status(false);assert.equal(result.connection,'CONNECTED');assert.equal(result.mcpConnections,3);assert.equal(result.workspaces[0].pageCount,2);assert.equal(result.workspaces[0].protectedPages,1);assert.equal(result.workspaces[0].leasedPages,1);
 assert.ok(!JSON.stringify(result).includes(page.targetId));
});
