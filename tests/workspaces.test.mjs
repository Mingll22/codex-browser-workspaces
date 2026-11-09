import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Workspaces} from '../dist/adapter/src/workspaces.js';
import {LEASE_MS} from '../dist/adapter/src/leases.js';
import {controllerProcess} from '../dist/adapter/src/controller-process.js';
import {OperationError} from '../dist/adapter/src/operation.js';

// The rows describe actual Chrome group membership, including foreign tabs.
class FakeBridge {
 generation='g1';extensionVersion='0.4.0';pageModelVersion=2;rows=new Map();groups=new Map();tabs=new Map();
 next=0;nextGroup=100;nextMembership=0;opens=0;requests=[];activeTabId;
 group(root,title=''){
  let group=this.groups.get(root);
  if(!group){group={id:++this.nextGroup,title};this.groups.set(root,group);}
  return group;
 }
 create(root,options={}){
  const tabId=++this.next,external=options.source==='external',group=root?this.group(root):undefined;
  const page={tabId,targetId:'t'+tabId,groupId:group?.id??-1,windowId:1,url:'about:blank',title:'Tab '+tabId,active:false,
   slot:null,retained:false,membershipId:'m'+(++this.nextMembership),source:external?'external':'managed',protected:external,
   canClose:!external,reusable:!external,...options};
  this.tabs.set(tabId,page);
  if(root){const rows=this.rows.get(root)??[];rows.push(page);this.rows.set(root,rows);}
  return page;
 }
 leave(root,page,{close=false}={}){
  this.rows.set(root,(this.rows.get(root)??[]).filter(row=>row!==page));
  if(!this.rows.get(root).length)this.groups.delete(root);
  page.groupId=-1;if(close)this.tabs.delete(page.tabId);
 }
 join(root,page){
  for(const [other,rows] of this.rows)if(rows.includes(page))this.leave(other,page);
  page.groupId=this.group(root).id;page.membershipId='m'+(++this.nextMembership);
  page.source='external';page.protected=true;page.canClose=false;page.reusable=false;page.slot=null;
  const rows=this.rows.get(root)??[];rows.push(page);this.rows.set(root,rows);
 }
 async request(method,a={}){
  this.requests.push({method,args:structuredClone(a)});
  const pages=this.rows.get(a.threadId)??[];
  if(method==='ping')return {generation:this.generation};
  if(method==='get_active_tab')return {generation:this.generation,page:this.activeTabId?structuredClone(this.tabs.get(this.activeTabId)):null};
  if(method==='title'){const group=this.groups.get(a.threadId);if(group)group.title=a.title;return {};}
  if(method==='finish_capture')return {generation:this.generation};
  if(method==='list')return {generation:this.generation,pages:pages.map((page,i)=>({...structuredClone(page),position:i+1})),
   workspace:{status:pages.length?'READY':this.groups.has(a.threadId)?'GROUP_PRESENT':'EMPTY',groupId:this.groups.get(a.threadId)?.id??null},runtime:{extension:this.extensionVersion}};
  if(method==='open'){
   await new Promise(resolve=>setImmediate(resolve));
   const old=pages.find(page=>page.slot===a.slot&&page.reusable);
   if(old){if(a.allowedTargetIds&&!a.allowedTargetIds.includes(old.targetId))throw new Error('PAGE_LEASE_BUSY');return {generation:this.generation,page:structuredClone(old),reused:true};}
   if(pages.length>=a.maxTabs)throw new Error('TAB_LIMIT_REACHED');
   const createdGroup=!this.groups.has(a.threadId);this.group(a.threadId,a.title).title=a.title;
   const page=this.create(a.threadId,{slot:a.slot});this.opens++;
   return {generation:this.generation,page:structuredClone(page),reused:false,createdGroup};
  }
  if(method==='move_tab_to_workspace'){
   const page=this.tabs.get(a.tabId);if(!page||page.targetId!==a.targetId)throw new Error('PAGE_TARGET_CHANGED');
   for(const [root,rows] of this.rows)if(root!==a.threadId&&rows.includes(page))throw new Error('PAGE_IN_ANOTHER_WORKSPACE');
   const reused=pages.includes(page);if(!reused)this.join(a.threadId,page);
   this.groups.get(a.threadId).title=a.title;this.activeTabId=page.tabId;page.active=true;
   return {generation:this.generation,page:structuredClone(page),reused};
  }
  const page=pages.find(page=>page.tabId===a.tabId&&page.targetId===a.targetId&&page.groupId===this.groups.get(a.threadId)?.id);
  if(!page)throw new Error('PAGE_NOT_OWNED');
  if(a.membershipId&&a.membershipId!==page.membershipId)throw new Error('PAGE_REFERENCE_EXPIRED');
  if(method==='close'){if(!page.canClose)throw new Error('PAGE_CLOSE_PROTECTED');this.leave(a.threadId,page,{close:true});}
  if(method==='retain')page.retained=a.retained;
  if(method==='prepare_capture')return {generation:this.generation,token:'capture-'+a.threadId};
  return {generation:this.generation,page:structuredClone(page)};
 }
}
const unwrap=result=>JSON.parse(result.content[0].text);
const liveOwner=()=>controllerProcess(process.pid);
const exitedOwner=()=>({...liveOwner(),startTime:'0'});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function setup(t,{ttl=null,grace=30000,maxTabs=2,families={},title=root=>'[Project]'+root}={}){
 const dir=await mkdtemp(join(tmpdir(),'cbw-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const clock={value:Date.now(),now(){return this.value;},advance(ms){this.value+=ms;}};
 const bridge=new FakeBridge();
 const upstream={epoch:'e1',calls:[],async mapping(ids){return new Map(ids.map(id=>[id,Number(id.slice(1))]));},async call(name,args,scope){
  this.calls.push({name,args:structuredClone(args),scope:[...scope]});
  if(name==='navigate_page'){const page=bridge.tabs.get(args.pageId);if(page)page.url=args.url;}
  return {content:[{type:'text',text:name==='take_snapshot'?'uid=1_2 button "Save"':'ok'}]};
 }};
 const threads={resolveRoot:caller=>families[caller]??caller,displayTitle:title},stateFile=join(dir,'state.json');
 const make=()=>new Workspaces(bridge,upstream,stateFile,maxTabs,ttl,undefined,grace,threads,()=>clock.now());
 const ws=make();await ws.load();return {ws,bridge,upstream,stateFile,clock,make};
}

test('lazy workspace creation, atomic slot reuse, same-URL preservation and hard cap',async t=>{
 const {ws,bridge,upstream}=await setup(t);
 assert.deepEqual(unwrap(await ws.call('c','a','list_pages',{})).pages,[]);assert.equal(bridge.groups.size,0);
 const results=await Promise.all(Array.from({length:20},()=>ws.call('c','a','open_page',{url:'https://example.org/'})));
 assert.equal(new Set(results.map(result=>unwrap(result).pageId)).size,1);assert.equal(bridge.opens,1);
 assert.equal(upstream.calls.filter(call=>call.name==='navigate_page').length,1);
 await ws.call('c','a','open_page',{url:'https://example.org/edit',slot:'edit'});
 await assert.rejects(ws.call('c','a','open_page',{url:'https://example.org/third',slot:'third'}),/TAB_LIMIT_REACHED/);
 assert.equal(bridge.groups.size,1);assert.equal(bridge.rows.get('a').length,2);
});

test('an extension without the required page model is refused before any browser request',async t=>{
 const {ws,bridge}=await setup(t);bridge.pageModelVersion=undefined;bridge.extensionVersion='0.3.1';
 await assert.rejects(ws.call('c','a','list_pages',{}),/EXTENSION_UPGRADE_REQUIRED/);assert.equal(bridge.requests.length,0);
});

test('siblings share the root group and title; another root cannot operate its pages',async t=>{
 const {ws,bridge,upstream}=await setup(t,{families:{child:'root',sibling:'root'},title:root=>'[Project]Title of '+root});
 const page=unwrap(await ws.call('child-connection','child','open_page',{url:'about:blank'}));
 assert.equal(bridge.groups.get('root').title,'[Project]Title of root');assert.equal(bridge.groups.has('child'),false);
 assert.deepEqual(unwrap(await ws.call('sibling-connection','sibling','list_pages',{})).pages,[]);
 await assert.rejects(ws.call('sibling-connection','sibling','open_page',{url:'about:blank'}),/PAGE_LEASE_BUSY/);assert.equal(bridge.opens,1);
 const calls=upstream.calls.length;
 for(const name of ['close_page','evaluate_script','take_screenshot','fill_form'])await assert.rejects(ws.call('foreign','other',name,{pageId:page.pageId}),/PAGE_NOT_OWNED/);
 assert.equal(upstream.calls.length,calls);
 await assert.rejects(ws.call('duplicate','child','list_pages',{}),/THREAD_ALREADY_ATTACHED/);
});

test('list does not renew a lease; page operations renew it up to the exact five-minute boundary',async t=>{
 const {ws,clock}=await setup(t,{families:{a:'root',b:'root'}});
 const page=unwrap(await ws.call('ca','a','open_page',{url:'about:blank'}));
 const initial=unwrap(await ws.call('ca','a','list_pages',{})).pages[0].lease.expiresAt;
 clock.advance(LEASE_MS-1);
 assert.equal(unwrap(await ws.call('ca','a','list_pages',{})).pages[0].lease.expiresAt,initial);
 assert.deepEqual(unwrap(await ws.call('cb','b','list_pages',{})).pages,[]);
 await ws.call('ca','a','take_snapshot',{pageId:page.pageId});
 const renewed=unwrap(await ws.call('ca','a','list_pages',{})).pages[0].lease.expiresAt;assert.equal(renewed,clock.now()+LEASE_MS);
 clock.advance(1);assert.deepEqual(unwrap(await ws.call('cb','b','list_pages',{})).pages,[]);
 clock.advance(LEASE_MS-2);assert.deepEqual(unwrap(await ws.call('cb','b','list_pages',{})).pages,[]);
 clock.advance(1);const available=unwrap(await ws.call('cb','b','list_pages',{})).pages[0];assert.equal(available.lease.status,'AVAILABLE');assert.notEqual(available.pageId,page.pageId);
 await assert.rejects(ws.call('ca','a','take_snapshot',{pageId:page.pageId}),/PAGE_LEASE_EXPIRED/);
});

test('simultaneous siblings can claim an available page only once',async t=>{
 const {ws,clock,upstream}=await setup(t,{families:{a:'root',b:'root',c:'root'}});
 await ws.call('ca','a','open_page',{url:'about:blank'});clock.advance(LEASE_MS);
 const b=unwrap(await ws.call('cb','b','list_pages',{})).pages[0],c=unwrap(await ws.call('cc','c','list_pages',{})).pages[0];assert.equal(b.pageId,c.pageId);
 const before=upstream.calls.length;
 const results=await Promise.allSettled([ws.call('cb','b','evaluate_script',{pageId:b.pageId,function:'()=>1'}),ws.call('cc','c','evaluate_script',{pageId:c.pageId,function:'()=>2'})]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.match(results.find(result=>result.status==='rejected').reason.message,/PAGE_LEASE_BUSY/);assert.equal(upstream.calls.length-before,1);
});

test('positions keep actual group gaps; a position number cannot authorize an operation',async t=>{
 const {ws,bridge}=await setup(t,{families:{a:'root',b:'root'},maxTabs:3});
 const first=unwrap(await ws.call('ca','a','open_page',{url:'about:blank',slot:'one'}));
 await ws.call('cb','b','open_page',{url:'about:blank',slot:'two'});await ws.call('ca','a','open_page',{url:'about:blank',slot:'three'});
 const pages=unwrap(await ws.call('ca','a','list_pages',{})).pages;
 assert.deepEqual(pages.map(page=>page.position),[1,3]);assert.deepEqual(pages.map(page=>page.title),['Tab 1','Tab 3']);
 assert.equal(pages[0].pageId,first.pageId);assert.equal(pages[0].active,false);
 const before=bridge.requests.filter(request=>request.method==='close').length;
 await assert.rejects(ws.call('ca','a','close_page',{pageId:'2'}),/PAGE_NOT_OWNED/);
 assert.equal(bridge.requests.filter(request=>request.method==='close').length,before);
});

test('release enables a fresh lease; old lease handles and element UIDs cannot cross the handover',async t=>{
 const {ws,upstream}=await setup(t,{families:{a:'root',b:'root'}});
 const first=unwrap(await ws.call('ca','a','open_page',{url:'about:blank'}));
 const snapshot=await ws.call('ca','a','take_snapshot',{pageId:first.pageId}),oldUid=snapshot.content[0].text.match(/uid=(\S+)/)[1];
 await ws.call('ca','a','release_page',{pageId:first.pageId});
 const second=unwrap(await ws.call('cb','b','list_pages',{})).pages[0];assert.notEqual(second.pageId,first.pageId);
 await ws.call('cb','b','take_snapshot',{pageId:second.pageId});const before=upstream.calls.length;
 await assert.rejects(ws.call('cb','b','click',{pageId:second.pageId,uid:oldUid}),/PAGE_NOT_OWNED/);
 await assert.rejects(ws.call('cb','b','take_snapshot',{pageId:first.pageId}),/PAGE_LEASE_EXPIRED/);assert.equal(upstream.calls.length,before);
});

test('manual removal and re-entry of the same target revokes its old membership handle',async t=>{
 const {ws,bridge,upstream}=await setup(t);
 const first=unwrap(await ws.call('c','a','open_page',{url:'about:blank'})),tab=bridge.rows.get('a')[0];
 bridge.leave('a',tab);bridge.join('a',tab);
 const second=unwrap(await ws.call('c','a','list_pages',{})).pages[0];assert.notEqual(second.pageId,first.pageId);assert.equal(second.canClose,false);
 const before=upstream.calls.length;await assert.rejects(ws.call('c','a','take_snapshot',{pageId:first.pageId}),/PAGE_NOT_OWNED|PAGE_REFERENCE_EXPIRED/);assert.equal(upstream.calls.length,before);
});

test('in-flight execution stays exclusive past expiry while a different page can progress',async t=>{
 const {ws,clock,upstream}=await setup(t,{families:{a:'root',b:'root'}});
 const page=unwrap(await ws.call('ca','a','open_page',{url:'about:blank'}));
 const gate=deferred(),started=deferred(),original=upstream.call.bind(upstream);
 upstream.call=async(name,args,scope)=>{if(name==='evaluate_script'&&args.pageId===1){started.resolve();await gate.promise;}return original(name,args,scope);};
 const pending=ws.call('ca','a','evaluate_script',{pageId:page.pageId,function:'()=>true'});await started.promise;clock.advance(LEASE_MS*2);
 assert.deepEqual(unwrap(await ws.call('cb','b','list_pages',{})).pages,[]);
 await assert.rejects(ws.call('cb','b','take_snapshot',{pageId:page.pageId}),/PAGE_LEASE_BUSY/);
 const other=unwrap(await ws.call('cc','other','open_page',{url:'about:blank'}));await ws.call('cc','other','take_snapshot',{pageId:other.pageId});
 gate.resolve();await pending;assert.equal(unwrap(await ws.call('cb','b','list_pages',{})).pages[0].lease.status,'AVAILABLE');
});

test('unknown upstream outcomes survive timeout and broker reload without releasing a sibling lease',async t=>{
 const {ws,clock,upstream,make}=await setup(t,{families:{a:'root',b:'root'}});
 const page=unwrap(await ws.call('ca','a','open_page',{url:'about:blank'}));
 upstream.call=async()=>{throw new OperationError('UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN',{outcome:'UNKNOWN'});};
 await assert.rejects(ws.call('ca','a','evaluate_script',{pageId:page.pageId,function:'()=>true'}),/UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN/);clock.advance(LEASE_MS*10);
 assert.equal(unwrap(await ws.call('ca','a','list_pages',{})).pages[0].lease.status,'UNKNOWN');assert.deepEqual(unwrap(await ws.call('cb','b','list_pages',{})).pages,[]);
 await assert.rejects(ws.call('ca','a','release_page',{pageId:page.pageId}),/PAGE_EXECUTION_UNKNOWN/);
 const restored=make();await restored.load();assert.deepEqual(unwrap(await restored.call('new-b','b','list_pages',{})).pages,[]);
 await assert.rejects(restored.call('new-a','a','take_snapshot',{pageId:page.pageId}),/PAGE_EXECUTION_UNKNOWN/);
});

test('target execution remains occupied after manual movement to another family and a new membership',async t=>{
 const {ws,bridge,clock,upstream}=await setup(t,{families:{a:'root-a',observer:'root-a',b:'root-b'}});
 const first=unwrap(await ws.call('ca','a','open_page',{url:'about:blank'})),tab=bridge.rows.get('root-a')[0];
 const gate=deferred(),started=deferred(),original=upstream.call.bind(upstream);
 upstream.call=async(name,args,scope)=>{started.resolve();await gate.promise;return original(name,args,scope);};
 const pending=ws.call('ca','a','evaluate_script',{pageId:first.pageId,function:'()=>true'}),rejected=assert.rejects(pending,/PAGE_NOT_OWNED|PAGE_REFERENCE_EXPIRED/);await started.promise;
 bridge.leave('root-a',tab);bridge.join('root-b',tab);bridge.activeTabId=tab.tabId;clock.advance(LEASE_MS*2);
 assert.deepEqual(unwrap(await ws.call('observe','observer','list_pages',{})).pages,[]);
 assert.deepEqual(unwrap(await ws.call('cb','b','list_pages',{})).pages,[]);
 const candidate=unwrap(await ws.call('cb','b','get_active_tab',{})).page,before=bridge.requests.filter(request=>request.method==='move_tab_to_workspace').length;
 await assert.rejects(ws.call('cb','b','move_tab_to_workspace',{pageId:candidate.pageId}),/PAGE_OPERATION_IN_PROGRESS|PAGE_LEASE_BUSY/);
 assert.equal(bridge.requests.filter(request=>request.method==='move_tab_to_workspace').length,before);
 gate.resolve();await rejected;assert.equal(unwrap(await ws.call('cb','b','list_pages',{})).pages[0].lease.status,'AVAILABLE');
});

test('unknown target execution cannot be cleared by moving the tab into a different family',async t=>{
 const {ws,bridge,upstream,clock}=await setup(t,{families:{a:'root-a',observer:'root-a',b:'root-b'}});
 const first=unwrap(await ws.call('ca','a','open_page',{url:'about:blank'})),tab=bridge.rows.get('root-a')[0];
 upstream.call=async()=>{throw new OperationError('UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN',{outcome:'UNKNOWN'});};
 await assert.rejects(ws.call('ca','a','evaluate_script',{pageId:first.pageId,function:'()=>true'}),/UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN/);
 bridge.leave('root-a',tab);bridge.join('root-b',tab);bridge.activeTabId=tab.tabId;clock.advance(LEASE_MS*10);
 await ws.call('observe','observer','list_pages',{});assert.deepEqual(unwrap(await ws.call('cb','b','list_pages',{})).pages,[]);
 const candidate=unwrap(await ws.call('cb','b','get_active_tab',{})).page,before=bridge.requests.filter(request=>request.method==='move_tab_to_workspace').length;
 await assert.rejects(ws.call('cb','b','move_tab_to_workspace',{pageId:candidate.pageId}),/PAGE_EXECUTION_UNKNOWN/);
 assert.equal(bridge.requests.filter(request=>request.method==='move_tab_to_workspace').length,before);
});

test('a failed ownership query preserves the existing handle and lease instead of revoking them',async t=>{
 const {ws,bridge}=await setup(t,{families:{a:'root',b:'root'}});
 const page=unwrap(await ws.call('ca','a','open_page',{url:'about:blank'})),original=bridge.request.bind(bridge);let fail=true;
 bridge.request=async(method,args)=>{if(method==='check'&&fail){fail=false;throw new OperationError('BRIDGE_TIMEOUT_OUTCOME_UNKNOWN',{outcome:'UNKNOWN'});}return original(method,args);};
 await assert.rejects(ws.call('ca','a','take_snapshot',{pageId:page.pageId}),/BRIDGE_TIMEOUT_OUTCOME_UNKNOWN/);
 assert.deepEqual(unwrap(await ws.call('cb','b','list_pages',{})).pages,[]);
 assert.match((await ws.call('ca','a','take_snapshot',{pageId:page.pageId})).content[0].text,/uid=/);
});

test('stale lease moves are rejected before bridge mutation; failed slot reuse keeps an unknown lease',async t=>{
 const {ws,bridge,clock}=await setup(t,{families:{a:'root',b:'root'}});
 const page=unwrap(await ws.call('ca','a','open_page',{url:'about:blank'}));clock.advance(LEASE_MS);
 const before=bridge.requests.filter(request=>request.method==='move_tab_to_workspace').length;
 await assert.rejects(ws.call('ca','a','move_tab_to_workspace',{pageId:page.pageId}),/PAGE_LEASE_EXPIRED/);
 assert.equal(bridge.requests.filter(request=>request.method==='move_tab_to_workspace').length,before);
 const original=bridge.request.bind(bridge);
 bridge.request=async(method,args)=>{if(method==='open')throw new OperationError('BRIDGE_DISCONNECTED',{outcome:'UNKNOWN'});return original(method,args);};
 await assert.rejects(ws.call('ca','a','open_page',{url:'about:blank'}),/BRIDGE_DISCONNECTED/);clock.advance(LEASE_MS*2);
 assert.equal(unwrap(await ws.call('ca','a','list_pages',{})).pages[0].lease.status,'UNKNOWN');assert.deepEqual(unwrap(await ws.call('cb','b','list_pages',{})).pages,[]);
});

test('active-tab discovery grants no authority; explicit move preserves the external tab protection',async t=>{
 const {ws,bridge,upstream,clock}=await setup(t,{ttl:1000});
 const external=bridge.create(undefined,{source:'external',url:'https://external.test/',active:true});bridge.activeTabId=external.tabId;
 const candidate=unwrap(await ws.call('c','a','get_active_tab',{})).page;assert.equal(bridge.groups.size,0);
 await assert.rejects(ws.call('c','a','take_snapshot',{pageId:candidate.pageId}),/PAGE_NOT_OWNED/);
 const moved=unwrap(await ws.call('c','a','move_tab_to_workspace',{pageId:candidate.pageId}));assert.equal(moved.canClose,false);
 const listed=unwrap(await ws.call('c','a','list_pages',{})).pages[0];
 assert.equal(listed.source,'external');assert.equal(listed.canClose,false);assert.equal(listed.reusable,false);assert.equal(listed.active,true);
 const calls=upstream.calls.length;await assert.rejects(ws.call('c','a','close_page',{pageId:moved.pageId}),/PAGE_CLOSE_PROTECTED/);assert.equal(upstream.calls.length,calls);
 await ws.call('c','a','open_page',{url:'about:blank'});assert.equal(bridge.tabs.get(external.tabId).url,'https://external.test/');
 await ws.detach('c');clock.advance(LEASE_MS*2);await ws.collect(clock.now());assert.equal(bridge.tabs.has(external.tabId),true);
});

test('reimport after leaving the family returns a usable lease and revokes the old membership',async t=>{
 const {ws,bridge,upstream}=await setup(t,{families:{a:'root',b:'root'}});
 const first=unwrap(await ws.call('ca','a','open_page',{url:'https://state.test/'})),tab=bridge.rows.get('root')[0];
 bridge.leave('root',tab);bridge.activeTabId=tab.tabId;
 const candidate=unwrap(await ws.call('ca','a','get_active_tab',{})).page;
 const moved=unwrap(await ws.call('ca','a','move_tab_to_workspace',{pageId:candidate.pageId}));
 assert.notEqual(moved.pageId,first.pageId);assert.equal(moved.canClose,false);
 await ws.call('ca','a','evaluate_script',{pageId:moved.pageId,function:'()=>true'});
 assert.equal(upstream.calls.at(-1).name,'evaluate_script');assert.equal(tab.url,'https://state.test/');
 assert.equal(unwrap(await ws.call('ca','a','list_pages',{})).pages[0].pageId,moved.pageId);
 assert.deepEqual(unwrap(await ws.call('cb','b','list_pages',{})).pages,[]);
 await assert.rejects(ws.call('ca','a','evaluate_script',{pageId:first.pageId,function:'()=>true'}),/PAGE_NOT_OWNED/);
 await assert.rejects(ws.call('cb','b','move_tab_to_workspace',{pageId:candidate.pageId}),/PAGE_LEASE_BUSY/);
});

test('released target can enter another family and return with usable fresh handles',async t=>{
 const {ws,bridge}=await setup(t);
 const first=unwrap(await ws.call('ca','a','open_page',{url:'about:blank'})),tab=bridge.rows.get('a')[0];
 await ws.call('ca','a','release_page',{pageId:first.pageId});bridge.leave('a',tab);bridge.activeTabId=tab.tabId;
 const candidate=unwrap(await ws.call('cb','b','get_active_tab',{})).page;
 const second=unwrap(await ws.call('cb','b','move_tab_to_workspace',{pageId:candidate.pageId}));
 await ws.call('cb','b','evaluate_script',{pageId:second.pageId,function:'()=>true'});
 await assert.rejects(ws.call('ca','a','take_snapshot',{pageId:first.pageId}),/PAGE_NOT_OWNED/);
 await ws.call('cb','b','release_page',{pageId:second.pageId});bridge.leave('b',tab);
 const returned=unwrap(await ws.call('ca','a','move_tab_to_workspace',{pageId:candidate.pageId}));
 await ws.call('ca','a','evaluate_script',{pageId:returned.pageId,function:'()=>true'});
 assert.notEqual(returned.pageId,first.pageId);assert.notEqual(returned.pageId,second.pageId);
 await assert.rejects(ws.call('cb','b','take_snapshot',{pageId:second.pageId}),/PAGE_NOT_OWNED/);
});

test('pending reimport keeps the target occupied across membership observation and timeout',async t=>{
 const {ws,bridge,clock}=await setup(t,{families:{a:'root',observer:'root',sibling:'root'}});
 await ws.call('ca','a','open_page',{url:'about:blank'});const tab=bridge.rows.get('root')[0];
 bridge.leave('root',tab);bridge.activeTabId=tab.tabId;
 const candidate=unwrap(await ws.call('ca','a','get_active_tab',{})).page;
 const gate=deferred(),started=deferred(),original=bridge.request.bind(bridge);
 bridge.request=async(method,args)=>{const result=await original(method,args);if(method==='move_tab_to_workspace'){started.resolve();await gate.promise;}return result;};
 const pending=ws.call('ca','a','move_tab_to_workspace',{pageId:candidate.pageId});await started.promise;
 // A sibling list observes the new membership before the initiating move returns.
 assert.deepEqual(unwrap(await ws.call('observe','observer','list_pages',{})).pages,[]);clock.advance(LEASE_MS*2);
 const before=bridge.requests.filter(request=>request.method==='move_tab_to_workspace').length;
 await assert.rejects(ws.call('foreign','foreign','move_tab_to_workspace',{pageId:candidate.pageId}),/PAGE_OPERATION_IN_PROGRESS|PAGE_LEASE_BUSY/);
 assert.equal(bridge.requests.filter(request=>request.method==='move_tab_to_workspace').length,before);
 gate.resolve();const moved=unwrap(await pending);
 assert.deepEqual(unwrap(await ws.call('sibling','sibling','list_pages',{})).pages,[]);
 await ws.call('ca','a','evaluate_script',{pageId:moved.pageId,function:'()=>true'});
});

test('foreign tabs inserted into the group stay protected and are never reused for a matching slot',async t=>{
 const {ws,bridge}=await setup(t,{maxTabs:3});await ws.call('c','a','open_page',{url:'about:blank'});
 const foreign=bridge.create('a',{source:'external',slot:'reference',url:'https://user.test/'});
 const rows=unwrap(await ws.call('c','a','list_pages',{})).pages;
 assert.equal(rows[1].position,2);assert.equal(rows[1].source,'external');assert.equal(rows[1].canClose,false);
 await ws.call('c','a','open_page',{url:'https://new.test/',slot:'reference'});assert.equal(bridge.rows.get('a').length,3);assert.equal(foreign.url,'https://user.test/');
});

test('last-tab closure and manual group removal stay empty on list and background collection',async t=>{
 const {ws,bridge,clock}=await setup(t,{ttl:1000});
 const page=unwrap(await ws.call('c','a','open_page',{url:'about:blank'}));await ws.call('c','a','close_page',{pageId:page.pageId});
 const opens=bridge.opens;assert.equal(bridge.groups.size,0);
 for(let i=0;i<3;i++)assert.equal(unwrap(await ws.call('c','a','list_pages',{})).workspace.status,'EMPTY');
 await ws.detach('c');clock.advance(LEASE_MS*2);await ws.collect(clock.now());assert.equal(bridge.groups.size,0);assert.equal(bridge.opens,opens);
 const fresh=unwrap(await ws.call('resume','a','open_page',{url:'about:blank'}));assert.notEqual(fresh.pageId,page.pageId);
 bridge.leave('a',bridge.rows.get('a')[0]);assert.deepEqual(unwrap(await ws.call('resume','a','list_pages',{})).pages,[]);assert.equal(bridge.groups.size,0);
});

test('child exit cannot collect its root family while the parent is attached or its controller is alive',async t=>{
 const {ws,bridge,clock}=await setup(t,{families:{child:'root'},ttl:1000});
 await ws.call('root-connection','root','list_pages',{},liveOwner());await ws.call('child-connection','child','open_page',{url:'about:blank'},exitedOwner());await ws.detach('child-connection');
 clock.advance(LEASE_MS*2);await ws.collect(clock.now());assert.equal(bridge.rows.get('root').length,1);
 await ws.detach('root-connection');clock.advance(LEASE_MS*2);await ws.collect(clock.now());assert.equal(bridge.rows.get('root').length,1);
});

test('root cleanup waits for exit, grace and page lease, then skips retained and external pages',async t=>{
 const {ws,bridge,clock}=await setup(t,{maxTabs:3});
 const retained=unwrap(await ws.call('c','a','open_page',{url:'about:blank',slot:'retained'},exitedOwner()));
 await ws.call('c','a','set_page_retention',{pageId:retained.pageId,retained:true},exitedOwner());
 await ws.call('c','a','open_page',{url:'about:blank',slot:'disposable'},exitedOwner());const external=bridge.create('a',{source:'external'});await ws.detach('c');
 await ws.collect(clock.now());clock.advance(29999);await ws.collect(clock.now());assert.equal(bridge.rows.get('a').length,3);
 clock.advance(1);await ws.collect(clock.now());assert.equal(bridge.rows.get('a').length,3);
 clock.advance(LEASE_MS);await ws.collect(clock.now());assert.deepEqual(bridge.rows.get('a').map(page=>page.tabId),[1,external.tabId]);assert.equal(bridge.groups.has('a'),true);
});

test('reconnect preserves the exact page and cancels process-exit cleanup',async t=>{
 const {ws,bridge,clock}=await setup(t,{ttl:1000});
 const page=unwrap(await ws.call('old','a','open_page',{url:'about:blank'},exitedOwner()));await ws.detach('old');
 assert.equal(unwrap(await ws.call('new','a','list_pages',{},liveOwner())).pages[0].pageId,page.pageId);
 await ws.detach('new');clock.advance(LEASE_MS*2);await ws.collect(clock.now());assert.equal(bridge.rows.get('a').length,1);
});

test('uncertain automatic close is not replayed and does not block another root cleanup',async t=>{
 const {ws,bridge,clock}=await setup(t,{ttl:1000});
 await ws.call('a','a','open_page',{url:'about:blank'});await ws.call('b','b','open_page',{url:'about:blank'});await ws.detach('a');await ws.detach('b');clock.advance(LEASE_MS*2);
 const original=bridge.request.bind(bridge);let closes=0;
 bridge.request=async(method,args)=>{if(method==='close'&&args.threadId==='a'){closes++;throw new Error('PAGE_CLOSE_PENDING');}return original(method,args);};
 await assert.rejects(ws.collect(clock.now()),/PAGE_CLOSE_PENDING/);assert.equal(bridge.rows.get('b').length,0);assert.equal(bridge.rows.get('a').length,1);
 await ws.collect(clock.now()+LEASE_MS);assert.equal(closes,1);
});

test('live disconnected and switched-away controllers survive reload; a changed generation requires reset',async t=>{
 const {ws,bridge,clock,make}=await setup(t,{ttl:1000});
 const first=unwrap(await ws.call('shared','a','open_page',{url:'about:blank'},liveOwner()));await ws.call('shared','b','open_page',{url:'about:blank'},liveOwner());await ws.detach('shared');clock.advance(LEASE_MS*2);
 const restored=make();await restored.load();await restored.collect(clock.now());assert.equal(bridge.rows.get('a').length,1);assert.equal(bridge.rows.get('b').length,1);
 assert.equal(unwrap(await restored.call('resume','a','list_pages',{},liveOwner())).pages[0].lease.status,'AVAILABLE');
 bridge.generation='g2';await assert.rejects(restored.call('resume','a','open_page',{url:'about:blank'}),/WORKSPACE_RESTORE_REQUIRED/);await restored.call('resume','a','reset_workspace',{acknowledgeLostPages:true});
 const fresh=unwrap(await restored.call('resume','a','list_pages',{})).pages[0];assert.notEqual(fresh.pageId,first.pageId);assert.match(fresh.pageId,/^p:g2:/);
});

test('captures serialize and restore on failure while unrelated page work remains concurrent',async t=>{
 const {ws,bridge,upstream}=await setup(t);
 const a=unwrap(await ws.call('ca','a','open_page',{url:'about:blank'})),b=unwrap(await ws.call('cb','b','open_page',{url:'about:blank'}));
 const gate=deferred(),started=deferred(),events=[],original=bridge.request.bind(bridge);
 bridge.request=async(method,args)=>{if(method==='prepare_capture'||method==='finish_capture')events.push(method+':'+args.threadId);return original(method,args);};
 upstream.call=async(name,args)=>{if(name==='take_screenshot'&&args.pageId===1){started.resolve();await gate.promise;throw new Error('SCREENSHOT_FAILED');}events.push(name+':'+args.pageId);return {content:[{type:'text',text:'ok'}]};};
 const first=ws.call('ca','a','take_screenshot',{pageId:a.pageId}),rejected=assert.rejects(first,/SCREENSHOT_FAILED/);await started.promise;
 const second=ws.call('cb','b','take_screenshot',{pageId:b.pageId});const c=unwrap(await ws.call('cc','c','open_page',{url:'about:blank'}));await ws.call('cc','c','evaluate_script',{pageId:c.pageId,function:'()=>true'});
 assert.equal(events.includes('prepare_capture:b'),false);assert.ok(events.includes('evaluate_script:3'));gate.resolve();await rejected;await second;
 assert.deepEqual(events.filter(event=>event.includes('capture:')),['prepare_capture:a','finish_capture:a','prepare_capture:b','finish_capture:b']);
});

test('opens never clean ordinary outside blank tabs, including after navigation failure',async t=>{
 const {ws,bridge,upstream}=await setup(t);const ordinary=bridge.create(undefined,{source:'external'});
 await ws.call('c','a','open_page',{url:'https://example.org/'});assert.equal(bridge.tabs.has(ordinary.tabId),true);
 upstream.call=async()=>({isError:true,content:[{type:'text',text:'navigation failed'}]});
 assert.equal((await ws.call('c','a','open_page',{url:'https://example.org/fail',slot:'fail'})).isError,true);
 assert.equal(bridge.tabs.has(ordinary.tabId),true);assert.equal(bridge.requests.some(request=>request.method==='finalize_open'),false);
});

test('persistence failure precedes browser mutations and repairing the directory permits later writes',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'cbw-write-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const parent=join(dir,'parent');await writeFile(parent,'blocks directory');const bridge=new FakeBridge();
 const ws=new Workspaces(bridge,{},join(parent,'state.json'),8,null,()=> 'test');
 await assert.rejects(ws.call('c','a','list_pages',{}),/EEXIST/);assert.equal(bridge.requests.length,0);
 await rm(parent);await mkdir(parent);await ws.call('c','a','list_pages',{});
 const first=await stat(join(parent,'state.json'));await new Promise(resolve=>setTimeout(resolve,10));
 await ws.call('c','a','list_pages',{});assert.equal((await stat(join(parent,'state.json'))).mtimeMs,first.mtimeMs);
 assert.equal(JSON.parse(await readFile(join(parent,'state.json'),'utf8')).version,2);
});

test('a failed lease write cannot dispatch upstream work and can recover once persistence is repaired',async t=>{
 const {ws,upstream,stateFile,clock}=await setup(t);
 const page=unwrap(await ws.call('c','a','open_page',{url:'about:blank'}));await mkdir(stateFile+'.tmp');clock.advance(1);
 const before=upstream.calls.length;await assert.rejects(ws.call('c','a','take_snapshot',{pageId:page.pageId}),/EISDIR/);assert.equal(upstream.calls.length,before);
 await rm(stateFile+'.tmp',{recursive:true});await ws.call('c','a','take_snapshot',{pageId:page.pageId});assert.equal(upstream.calls.length,before+1);
});

test('a rejected foreign candidate never holds the original family available page',async t=>{
 const {ws,bridge}=await setup(t);await ws.call('a','a','open_page',{url:'about:blank'});
 const owned=unwrap(await ws.call('a','a','list_pages',{})).pages[0];await ws.call('a','a','release_page',{pageId:owned.pageId});
 const tab=bridge.rows.get('a')[0],candidate=`candidate:g1:${tab.targetId}:${tab.tabId}`;
 await assert.rejects(ws.call('b','b','move_tab_to_workspace',{pageId:candidate}),/PAGE_IN_ANOTHER_WORKSPACE/);
 assert.equal(unwrap(await ws.call('a','a','list_pages',{})).pages.length,1);
});

test('a child-first browser family without root lifetime evidence survives the child exit',async t=>{
 const {ws,bridge,clock}=await setup(t,{families:{child:'root'},ttl:1000});
 await ws.call('child-connection','child','open_page',{url:'about:blank'},exitedOwner());await ws.detach('child-connection');clock.advance(LEASE_MS*2);
 await ws.collect(clock.now());await ws.collect(clock.now()+LEASE_MS);assert.equal(bridge.rows.get('root').length,1);
});

test('current membership revokes an idle prior grant even when broker missed the departure or restarted',async t=>{
 const {ws,bridge,make}=await setup(t);const old=unwrap(await ws.call('a','a','open_page',{url:'about:blank'}));
 const tab=bridge.rows.get('a')[0];bridge.join('b',tab);
 const listed=unwrap(await ws.call('b','b','list_pages',{}));assert.equal(listed.pages.length,1);await ws.call('b','b','take_snapshot',{pageId:listed.pages[0].pageId});
 await assert.rejects(ws.call('a','a','take_snapshot',{pageId:old.pageId}),/PAGE_NOT_OWNED/);
 const restored=make();await restored.load();bridge.join('a',tab);
 const again=unwrap(await restored.call('new','a','list_pages',{}));assert.equal(again.pages.length,1);await restored.call('new','a','take_snapshot',{pageId:again.pages[0].pageId});
});

test('completed cleanup stops rescanning protected or retained groups until their family reconnects',async t=>{
 const {ws,bridge,clock}=await setup(t,{ttl:1000});const page=unwrap(await ws.call('a','a','open_page',{url:'about:blank'}));
 await ws.call('a','a','set_page_retention',{pageId:page.pageId,retained:true});await ws.call('a','a','release_page',{pageId:page.pageId});
 bridge.create('a',{source:'external'});await ws.detach('a');clock.advance(LEASE_MS*2);await ws.collect(clock.now());
 const lists=bridge.requests.filter(request=>request.method==='list').length;
 await ws.collect(clock.now()+LEASE_MS);assert.equal(bridge.requests.filter(request=>request.method==='list').length,lists);
 await ws.call('resume','a','list_pages',{});await ws.detach('resume');clock.advance(LEASE_MS*2);await ws.collect(clock.now());
 assert.ok(bridge.requests.filter(request=>request.method==='list').length>lists);
});
