import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Workspaces} from '../dist/adapter/src/workspaces.js';
import {pageHandle} from '../dist/adapter/src/references.js';
class FakeBridge {
 generation='g1';rows=new Map();next=0;opens=0;finalizations=[];
 async request(method,a){
  const pages=this.rows.get(a?.threadId)??[];
  if(method==='ping')return {generation:this.generation};
  if(method==='title')return {};
  if(method==='finish_capture')return {generation:this.generation};
  if(method==='finalize_open'){this.finalizations.push(a);return {generation:this.generation,closedBlankTabs:1};}
  if(method==='list')return {generation:this.generation,pages:structuredClone(pages)};
  if(method==='open'){
   await new Promise(resolve=>setTimeout(resolve,2));const old=pages.find(p=>p.slot===a.slot);if(old)return {generation:this.generation,page:old,reused:true};
   if(pages.length>=a.maxTabs)throw new Error('TAB_LIMIT_REACHED');
   const createdGroup=pages.length===0;
   const p={tabId:++this.next,targetId:'t'+this.next,groupId:this.next,url:'about:blank',slot:a.slot,retained:false};pages.push(p);this.rows.set(a.threadId,pages);this.opens++;return {generation:this.generation,page:p,reused:false,createdGroup};
  }
  const page=pages.find(p=>p.tabId===a.tabId&&p.targetId===a.targetId);if(!page)throw new Error('PAGE_NOT_OWNED');
  if(method==='close')this.rows.set(a.threadId,pages.filter(p=>p!==page));
  if(method==='retain')page.retained=a.retained;
  return {generation:this.generation,page};
 }
}
const unwrap=r=>JSON.parse(r.content[0].text);
async function setup(t,ttl=null){
 const dir=await mkdtemp(join(tmpdir(),'cbw-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const bridge=new FakeBridge();const upstream={epoch:'e1',calls:[],async mapping(ids){return new Map(ids.map(id=>[id,Number(id.slice(1))]));},async call(name,args,scope){this.calls.push({name,args,scope});if(name==='navigate_page')for(const pages of bridge.rows.values())for(const p of pages)if(p.tabId===args.pageId)p.url=args.url;return {content:[{type:'text',text:'ok'}]};}};
 const ws=new Workspaces(bridge,upstream,join(dir,'state.json'),2,ttl,()=> 'Same title');await ws.load();return {ws,bridge,upstream};
}
test('lazy workspace, atomic slot reuse, hard cap, and last-page recreation',async t=>{
 const {ws,bridge}=await setup(t);
 assert.deepEqual(unwrap(await ws.call('c','a','list_pages',{})).pages,[]);assert.equal(bridge.opens,0);
 const results=await Promise.all(Array.from({length:20},(_,i)=>ws.call('c','a','open_page',{url:'https://example.org/'+i})));
 assert.equal(new Set(results.map(r=>unwrap(r).pageId)).size,1);assert.equal(bridge.opens,1);
 const second=unwrap(await ws.call('c','a','open_page',{url:'https://example.org/edit',slot:'edit'}));
 await assert.rejects(ws.call('c','a','open_page',{url:'https://example.org/third',slot:'third'}),/TAB_LIMIT_REACHED/);
 for(const p of unwrap(await ws.call('c','a','list_pages',{})).pages)await ws.call('c','a','close_page',{pageId:p.pageId});
 const newPage=unwrap(await ws.call('c','a','open_page',{url:'https://example.org/again'}));assert.notEqual(newPage.pageId,second.pageId);assert.equal(bridge.rows.get('a').length,1);
});
test('cross-thread negative calls never reach the upstream',async t=>{
 const {ws,upstream}=await setup(t);const b=unwrap(await ws.call('cb','b','open_page',{url:'https://example.org'}));const n=upstream.calls.length;
 for(const name of ['close_page','evaluate_script','take_screenshot','get_network_request','fill_form'])await assert.rejects(ws.call('ca','a',name,{pageId:b.pageId}),/PAGE_NOT_OWNED/);
 assert.equal(upstream.calls.length,n);await assert.rejects(ws.call('other','b','list_pages',{}),/THREAD_ALREADY_ATTACHED/);
});
test('resume keeps pages, manual removal revokes access, browser generation requires explicit reset',async t=>{
 const {ws,bridge}=await setup(t);const p=unwrap(await ws.call('c','a','open_page',{url:'https://example.org'}));await ws.detach('c');
 assert.equal(unwrap(await ws.call('resume','a','list_pages',{})).pages[0].pageId,p.pageId);
 bridge.rows.set('a',[]);await assert.rejects(ws.call('resume','a','take_snapshot',{pageId:p.pageId}),/PAGE_NOT_OWNED/);
 bridge.generation='g2';await assert.rejects(ws.call('resume','a','open_page',{url:'https://example.org'}),/WORKSPACE_RESTORE_REQUIRED/);
 await ws.call('resume','a','reset_workspace',{acknowledgeLostPages:true});const q=unwrap(await ws.call('resume','a','open_page',{url:'https://example.org'}));assert.match(q.pageId,/g2/);
});
test('TTL is opt-in, never collects attached or retained pages, and respects reconnect',async t=>{
 const {ws,bridge}=await setup(t,1000);const p=unwrap(await ws.call('c','a','open_page',{url:'https://example.org'}));
 await ws.collect(Date.now()+100000);assert.equal(bridge.rows.get('a').length,1);
 await ws.call('c','a','set_page_retention',{pageId:p.pageId,retained:true});await ws.detach('c');await ws.collect(Date.now()+100000);assert.equal(bridge.rows.get('a').length,1);
 await ws.call('new','a','set_page_retention',{pageId:p.pageId,retained:false});await ws.collect(Date.now()+100000);assert.equal(bridge.rows.get('a').length,1);
 await ws.detach('new');await ws.collect(Date.now()+100000);assert.equal(bridge.rows.get('a').length,0);
 const fresh=await setup(t);await fresh.ws.call('c','a','open_page',{url:'https://example.org'});await fresh.ws.detach('c');await fresh.ws.collect(Date.now()+100000000);assert.equal(fresh.bridge.rows.get('a').length,1);
});
test('collection waits for in-flight work and a reconnect cancels queued collection',async t=>{
 const {ws,bridge,upstream}=await setup(t,1000);const p=unwrap(await ws.call('old','a','open_page',{url:'https://example.org'}));
 let release,started;const gate=new Promise(r=>release=r);const entered=new Promise(r=>started=r);
 upstream.call=async()=>{started();await gate;return {content:[{type:'text',text:'done'}]};};
 const inFlight=ws.call('old','a','evaluate_script',{pageId:p.pageId,function:'()=>true'});await entered;await ws.detach('old');
 const collection=ws.collect(Date.now()+100000);const resumed=ws.call('new','a','list_pages',{});
 await new Promise(r=>setTimeout(r,10));assert.equal(bridge.rows.get('a').length,1);release();await inFlight;await collection;
 assert.equal(unwrap(await resumed).pages[0].pageId,p.pageId);
});
test('shared-window captures serialize, restore on failure, and leave other page work concurrent',async t=>{
 const {ws,bridge,upstream}=await setup(t);
 const a=unwrap(await ws.call('ca','a','open_page',{url:'about:blank'}));const b=unwrap(await ws.call('cb','b','open_page',{url:'about:blank'}));
 const events=[];let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const original=bridge.request.bind(bridge);
 bridge.request=async(method,args)=>{if(method==='prepare_capture'||method==='finish_capture')events.push(method+':'+args.threadId);const result=await original(method,args);if(method==='prepare_capture')result.token='capture-'+args.threadId;return result;};
 upstream.call=async(name,args)=>{if(name==='take_screenshot'&&args.pageId===1){entered();await gate;throw new Error('SCREENSHOT_FAILED');}events.push(name+':'+args.pageId);return {content:[{type:'text',text:'ok'}]};};
 const first=ws.call('ca','a','take_screenshot',{pageId:a.pageId});const rejected=assert.rejects(first,/SCREENSHOT_FAILED/);await started;
 const second=ws.call('cb','b','take_screenshot',{pageId:b.pageId});
 // A third thread can still read its page while a screenshot holds the window.
 const c=unwrap(await ws.call('cc','c','open_page',{url:'about:blank'}));await ws.call('cc','c','evaluate_script',{pageId:c.pageId,function:'()=>true'});
 assert.equal(events.includes('prepare_capture:b'),false);assert.ok(events.includes('evaluate_script:3'));
 release();await rejected;await second;
 assert.deepEqual(events.filter(e=>e.includes('capture:')),['prepare_capture:a','finish_capture:a','prepare_capture:b','finish_capture:b']);
});
test('successful opens notify adapter cleanup with a force flag only for new groups',async t=>{
 const {ws,bridge,upstream}=await setup(t);
 const invoke=upstream.call.bind(upstream);
 upstream.call=async(...args)=>{assert.equal(bridge.finalizations.length,0);return invoke(...args);};
 const page=unwrap(await ws.call('c','a','open_page',{url:'https://example.org'}));assert.equal(page.closedBlankTabs,1);assert.equal(bridge.finalizations.length,1);
 upstream.call=invoke;
 await ws.call('c','a','open_page',{url:'https://example.org'});await ws.call('c','a','open_page',{url:'about:blank',slot:'reference'});assert.deepEqual(bridge.finalizations.map(a=>a.createdGroup),[true,false,false]);
 const failure=await setup(t);failure.upstream.call=async()=>({isError:true,content:[{type:'text',text:'navigation failed'}]});
 assert.equal((await failure.ws.call('c','a','open_page',{url:'https://example.org/fail'})).isError,true);assert.equal(failure.bridge.finalizations.length,0);
});
test('failed persistence reports error but a repaired directory accepts the next write',async t=>{
 const {writeFile,mkdir,stat}=await import('node:fs/promises');
 const dir=await mkdtemp(join(tmpdir(),'cbw-write-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const parent=join(dir,'parent');await writeFile(parent,'blocks directory');
 const bridge=new FakeBridge(),ws=new Workspaces(bridge,{},join(parent,'state.json'),8,null,()=> 'test');
 await assert.rejects(ws.call('c','a','list_pages',{}),/EEXIST/);
 await rm(parent);await mkdir(parent);await ws.call('c','a','list_pages',{});
 const first=await stat(join(parent,'state.json'));await new Promise(r=>setTimeout(r,10));
 await ws.call('c','a','list_pages',{});assert.equal((await stat(join(parent,'state.json'))).mtimeMs,first.mtimeMs);
});
