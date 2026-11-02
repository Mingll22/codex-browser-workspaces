import {config} from './config.js';
let socket;
let reconnectAttempt=0;
const connectionEvents=[];
function connectionEvent(phase,details={}){connectionEvents.push({at:Date.now(),phase,...details});if(connectionEvents.length>16)connectionEvents.shift();}
// Read-only diagnostic snapshot for the admin's scoped official MCP inspection.
globalThis.cbwConnectionStatus=()=>({events:[...connectionEvents],readyState:socket?.readyState,reconnectAttempt});
let state;
let capture;
let captureTimer;
const groupColors=['cyan','pink','yellow','orange','green','purple','blue','red'];
const blankUrls=new Set(['about:blank','chrome://newtab/','chrome://new-tab-page/']);
const blankCleanupIntervalMs=60_000;
let lastBlankCleanupAt=0;
let savedData;
async function save(){
  const data=JSON.stringify(state);
  if(data===savedData)return;
  await chrome.storage.session.set({state:JSON.parse(data)});savedData=data;
}
function event(kind,threadId,details={}){
  state.events??=[];state.events.push({at:Date.now(),kind,threadId,...details});state.events=state.events.slice(-64);
}
function revoke(threadId,key,reason){
  const ws=state.workspaces[threadId],record=ws.tabs[key];if(!record)return;
  ws.revoked??=[];ws.revoked.push({targetId:record.targetId,slot:record.slot,reason,at:Date.now()});ws.revoked=ws.revoked.slice(-32);
  delete ws.tabs[key];event('ownership_revoked',threadId,{tabId:Number(key),reason});
}
let activeRequest;
function checkpoint(){
  if(activeRequest&&(activeRequest.cancelled||Date.now()>=activeRequest.deadline)){
    const error=new Error(activeRequest.cancelled?'REQUEST_CANCELLED':'REQUEST_TIMEOUT');
    error.details={outcome:activeRequest.dispatched?'UNKNOWN':'NOT_STARTED',nextAction:activeRequest.dispatched?'inspect_page_before_retry':'retry_when_ready'};throw error;
  }
}
function mutate(fn){checkpoint();if(activeRequest)activeRequest.dispatched=true;return fn();}
// A Chrome close request can remain pending (for example after beforeunload).
// Keep its uncertain outcome explicit without holding every workspace's queue.
async function removeOwnedTab(tabId){
  let timer;
  try {
    await Promise.race([mutate(()=>chrome.tabs.remove(tabId)),new Promise((_,reject)=>{
      timer=setTimeout(()=>{const error=new Error('PAGE_CLOSE_PENDING');error.details={outcome:'UNKNOWN',nextAction:'inspect_page_before_retry'};reject(error);},Math.max(1,Math.min(10000,(activeRequest?.deadline??Infinity)-Date.now())));
    })]);
  }finally{clearTimeout(timer);}
}

const ready=chrome.storage.session.get('state').then(async initial=>{
  const {workspaceUpgrade}=await chrome.storage.local.get('workspaceUpgrade');
  if(!initial.state&&workspaceUpgrade){
    // Explicit admin upgrade only: never restore ownership across a browser
    // session or infer it from a title, URL, or recycled numeric tab ID.
    const targets=await chrome.debugger.getTargets();
    for(const receipt of workspaceUpgrade.targets){
      const tab=await chrome.tabs.get(receipt.tabId);
      if(tab.groupId!==receipt.groupId||tab.windowId!==receipt.windowId||!targets.some(t=>t.tabId===tab.id&&t.id===receipt.targetId))throw new Error('WORKSPACE_UPGRADE_TARGET_CHANGED');
    }
  }
  state=initial.state??workspaceUpgrade?.state??{generation:crypto.randomUUID(),workspaces:{}};
  state.pendingPopups??={};
  const windows=new Set(Object.values(state.workspaces).filter(ws=>Object.keys(ws.tabs).length).map(ws=>ws.windowId));
  if(state.windowId===undefined&&windows.size===1)state.windowId=[...windows][0];
  await save();
  if(workspaceUpgrade)await chrome.storage.local.remove('workspaceUpgrade');
});
let queue=ready.catch(()=>{});
function enqueue(fn){
  const task=queue.then(()=>ready).then(fn);
  queue=task.catch(error=>{console.error('Workspace queue operation failed:',error.message);if(state)event('queue_failed',undefined,{code:/^[A-Z_]+$/.test(error.message)?error.message:'STATE_OR_BROWSER_API_FAILED'});});
  return task;
}
const fail=code=>{throw new Error(code);};
function missingPage(threadId,targetId){
  const record=state.workspaces[threadId]?.revoked?.find(r=>r.targetId===targetId);
  const error=new Error('PAGE_NOT_OWNED');error.details={reason:record?.reason??'UNKNOWN_OR_FOREIGN_PAGE',nextAction:'list_pages_then_open_page'};throw error;
}
function colorFor(ws){
  if(!ws.color){
    const used=new Set(Object.values(state.workspaces).filter(w=>Object.keys(w.tabs).length).map(w=>w.color));
    const unused=groupColors.filter(color=>!used.has(color));
    const pool=unused.length?unused:groupColors;
    ws.color=pool[Math.floor(Math.random()*pool.length)];
  }
  return ws.color;
}
async function pages(threadId) {
  const ws=state.workspaces[threadId];
  if(!ws)return [];
  const result=[];
  // A successful browser-wide metadata snapshot is positive evidence of removal.
  // A failed query leaves all ownership records intact and surfaces the API error.
  const tabs=await chrome.tabs.query({});
  const targets=await chrome.debugger.getTargets();
  for(const [key,record] of Object.entries(ws.tabs)) {
    const tab=tabs.find(t=>t.id===Number(key));
    if(!tab){revoke(threadId,key,'CLOSED');continue;}
    if(tab.groupId!==ws.groupId){revoke(threadId,key,'MOVED_OUT_OF_GROUP');continue;}
    const target=targets.find(t=>t.tabId===tab.id&&t.type==='page');
    if(!target)fail('PAGE_MAPPING_UNAVAILABLE');
    if(record.targetId&&record.targetId!==target.id){revoke(threadId,key,'TARGET_REPLACED');continue;}
    record.targetId=target.id;
    result.push({...record,tabId:tab.id,targetId:target.id,url:tab.url??'',groupId:tab.groupId,windowId:tab.windowId});
  }
  await save();return result;
}
async function handle(method,args,request){
  activeRequest=request;
  try{
    checkpoint();const result=await handleCore(method,args);
    if(method==='prepare_capture'&&request&&(request.cancelled||Date.now()>=request.deadline)){
      activeRequest=undefined;await handleCore('finish_capture',{threadId:args.threadId,token:result.token});activeRequest=request;checkpoint();
    }
    return result;
  }
  finally{activeRequest=undefined;}
}

async function handleCore(method,args) {
  if(method==='finalize_open'){
    const own=await pages(args.threadId);
    const page=own.find(p=>p.tabId===args.tabId&&p.targetId===args.targetId);
    if(!page)missingPage(args.threadId,args.targetId);
    if(page.windowId!==state.windowId)fail('WORKSPACE_WINDOW_CHANGED');
    if(!args.createdGroup&&Date.now()-lastBlankCleanupAt<blankCleanupIntervalMs)return {generation:state.generation,closedBlankTabs:0};
    lastBlankCleanupAt=Date.now();
    // User-authorized window housekeeping, separate from page ownership.
    // Never infer that another thread's blank page is disposable.
    const registered=new Set(Object.values(state.workspaces).flatMap(ws=>Object.keys(ws.tabs).map(Number)));
    const disposable=tab=>tab.windowId===state.windowId&&tab.groupId===-1&&!tab.pinned&&tab.openerTabId===undefined&&!tab.pendingUrl&&tab.status!=='loading'&&blankUrls.has(tab.url)&&!registered.has(tab.id);
    let closedBlankTabs=0;
    for(const candidate of (await chrome.tabs.query({windowId:state.windowId})).filter(disposable)){
      // Recheck immediately before closing: a new-tab page may have begun
      // navigation while the new workspace was being prepared.
      const current=await chrome.tabs.get(candidate.id);
      if(!disposable(current))continue;
      await mutate(()=>chrome.tabs.remove(current.id));closedBlankTabs++;
    }
    return {generation:state.generation,closedBlankTabs};
  }
  if(method==='adopt_popup') {
    if(args.generation!==state.generation)fail('WORKSPACE_RESTORE_REQUIRED');
    const pending=state.pendingPopups[args.tabId];
    if(!pending||pending.targetId!==args.targetId)return {};
    const target=(await chrome.debugger.getTargets()).find(t=>t.tabId===args.tabId);
    if(!target||target.id!==args.targetId){delete state.pendingPopups[args.tabId];await save();return {};}
    const tab=await chrome.tabs.get(args.tabId);
    if(tab.groupId===pending.initialGroupId&&args.openerTargetId){
      for(const [threadId,ws] of Object.entries(state.workspaces)){
        const own=await pages(threadId);
        if(!own.some(p=>p.targetId===args.openerTargetId))continue;
        if(own.some(p=>p.tabId===args.tabId))break;
        if(own.length>=ws.maxTabs)await mutate(()=>chrome.tabs.remove(args.tabId));
        else {
          await mutate(()=>chrome.tabs.group({tabIds:args.tabId,groupId:ws.groupId}));
          ws.tabs[args.tabId]={slot:`popup-${args.tabId}`,retained:false,targetId:args.targetId};event('popup_adopted',threadId,{tabId:args.tabId,groupId:ws.groupId});
        }
        break;
      }
    }
    delete state.pendingPopups[args.tabId];await save();return {};
  }
  if(method==='ping')return {generation:state.generation,version:chrome.runtime.getManifest().version};
  if(method==='list'){
    const own=await pages(args.threadId),ws=state.workspaces[args.threadId];
    const group=ws&&(await chrome.tabGroups.query({})).find(g=>g.id===ws.groupId);
    return {generation:state.generation,pages:own,workspace:{status:own.length?'READY':group?'GROUP_PRESENT':'EMPTY',groupId:group?.id??null,nextAction:own.length?'use_owned_page':'open_page',revoked:ws?.revoked??[],events:(state.events??[]).filter(e=>e.threadId===args.threadId).slice(-12)},runtime:{extension:chrome.runtime.getManifest().version}};
  }
  if(method==='open') {
    let ws=state.workspaces[args.threadId];
    if(!ws)ws=state.workspaces[args.threadId]={tabs:{},groupId:null};
    const current=await pages(args.threadId);
    const existing=current.find(p=>p.slot===args.slot);
    if(existing)return {generation:state.generation,page:existing,reused:true};
    if(current.length>=args.maxTabs)fail('TAB_LIMIT_REACHED');
    ws.maxTabs=args.maxTabs;
    let tab;
    const windows=(await chrome.windows.getAll({windowTypes:['normal']})).filter(w=>!w.incognito);
    let window=windows.find(w=>w.id===state.windowId);
    if(current.length&&(!window||current.some(p=>p.windowId!==state.windowId)))fail('WORKSPACE_WINDOW_CHANGED');
    if(!window&&windows.length){
      // Bind once to the browser's existing default/last-used normal window.
      // A window selection grants no ownership over its existing tabs.
      window=await chrome.windows.getLastFocused({windowTypes:['normal']});
      if(!windows.some(w=>w.id===window.id))fail('WORKSPACE_WINDOW_UNAVAILABLE');
      state.windowId=window.id;
    }
    // Page ownership can be empty while ordinary user tabs keep the bound
    // group alive. Reuse that exact group, never a title/color match.
    const group=ws.groupId===null ? undefined : (await chrome.tabGroups.query({})).find(g=>g.id===ws.groupId);
    if(group&&group.windowId!==state.windowId)fail('WORKSPACE_WINDOW_CHANGED');
    if(window){
      tab=await mutate(()=>chrome.tabs.create({url:'about:blank',active:false,windowId:window.id}));
    }else{
      if(Object.values(state.workspaces).some(w=>Object.keys(w.tabs).length))fail('WORKSPACE_WINDOW_CHANGED');
      const window=await mutate(()=>chrome.windows.create({url:'about:blank',focused:false,type:'normal'}));
      tab=window.tabs[0];state.windowId=window.id;
    }
    ws.windowId=state.windowId;
    try {
      const groupId=await mutate(()=>chrome.tabs.group(group ? {tabIds:tab.id,groupId:group.id} : {tabIds:tab.id,createProperties:{windowId:ws.windowId}}));
      ws.groupId=groupId;event(group?'group_reused':'group_created',args.threadId,{groupId,tabId:tab.id});
      ws.tabs[tab.id]={slot:args.slot,retained:false};
      await save();
      await mutate(()=>chrome.tabGroups.update(groupId,{title:args.title,color:colorFor(ws)}));
      await save();
      return {generation:state.generation,page:(await pages(args.threadId)).find(p=>p.tabId===tab.id),reused:false,createdGroup:!group};
    } catch(e) {
      // Only the newly created tab belongs to this failed operation.
      await chrome.tabs.remove(tab.id);
      delete ws.tabs[tab.id];await save();throw e;
    }
  }
  if(method==='title') {
    const own=await pages(args.threadId);
    if(own.length){const ws=state.workspaces[args.threadId],group=await chrome.tabGroups.get(ws.groupId),color=colorFor(ws);if(group.title!==args.title||group.color!==color)await mutate(()=>chrome.tabGroups.update(ws.groupId,{title:args.title,color}));await save();}
    return {};
  }
  if(method==='prepare_capture') {
    const own=await pages(args.threadId);
    const page=own.find(p=>p.tabId===args.tabId&&p.targetId===args.targetId);
    if(!page)missingPage(args.threadId,args.targetId);
    const ws=state.workspaces[args.threadId];
    if(page.windowId!==state.windowId||page.windowId!==ws.windowId)fail('WORKSPACE_WINDOW_CHANGED');
    if(capture)fail('CAPTURE_ALREADY_IN_PROGRESS');
    const tabs=await chrome.tabs.query({windowId:state.windowId});
    const active=tabs.find(t=>t.active);
    const previousTarget=active&&(await chrome.debugger.getTargets()).find(t=>t.tabId===active.id&&t.type==='page');
    if(active&&!previousTarget)fail('PAGE_MAPPING_UNAVAILABLE');
    // Restoring window tab selection also covers a user's ordinary active tab;
    // no page content or automation permission is granted to that tab.
    const previous=active&&{tabId:active.id,targetId:previousTarget.id,groupId:active.groupId};
    // Tab selection is required for capture; keep the OS window minimized and
    // unfocused. The upstream captures from the compositor surface.
    const group=await chrome.tabGroups.get(ws.groupId);
    await mutate(()=>chrome.tabs.update(page.tabId,{active:true}));
    capture={request:activeRequest,token:crypto.randomUUID(),threadId:args.threadId,tabId:page.tabId,windowId:state.windowId,groupId:ws.groupId,collapsed:group.collapsed,previous};
    const lease=capture;
    captureTimer=setTimeout(()=>{if(capture===lease)void enqueue(()=>handle('finish_capture',{threadId:lease.threadId,token:lease.token})).catch(()=>{});},45000);captureTimer?.unref?.();
    return {generation:state.generation,page,token:capture.token};
  }
  if(method==='finish_capture'){
    if(!capture||capture.token!==args.token||capture.threadId!==args.threadId)fail('CAPTURE_NOT_OWNED');
    const lease=capture;capture=undefined;clearTimeout(captureTimer);captureTimer=undefined;
    const tabs=await chrome.tabs.query({windowId:lease.windowId});
    if(tabs.find(t=>t.active)?.id===lease.tabId&&lease.previous&&tabs.some(t=>t.id===lease.previous.tabId)){
      const targets=await chrome.debugger.getTargets();
      if(targets.some(p=>p.tabId===lease.previous.tabId&&p.id===lease.previous.targetId)){
        await mutate(()=>chrome.tabs.update(lease.previous.tabId,{active:true}));
        if(lease.collapsed&&lease.previous.groupId!==lease.groupId)await mutate(()=>chrome.tabGroups.update(lease.groupId,{collapsed:true}));
      }
    }
    return {generation:state.generation};
  }
  if(method==='close'||method==='retain'||method==='check') {
    const own=(await pages(args.threadId)).find(p=>p.tabId===args.tabId&&p.targetId===args.targetId);
    if(!own)missingPage(args.threadId,args.targetId);
    if(method==='close') {
      await removeOwnedTab(own.tabId);
      revoke(args.threadId,String(own.tabId),'CLOSED');await save();
    } else if(method==='retain') {
      state.workspaces[args.threadId].tabs[own.tabId].retained=args.retained;await save();
    }
    return {generation:state.generation,page:own};
  }
  fail('UNKNOWN_BRIDGE_METHOD');
}
const requests=new Map();
function connect() {
  if(socket&&socket.readyState<2)return;
  connectionEvent('connecting');
  const peer=socket=new WebSocket(config.url);
  peer.onopen=()=>{connectionEvent('open');reconnectAttempt=0;peer.send(JSON.stringify({type:'hello',token:config.token,generation:state.generation,version:chrome.runtime.getManifest().version}));for(const pending of Object.values(state.pendingPopups))peer.send(JSON.stringify({type:'popup',generation:state.generation,...pending}));};
  peer.onmessage=event=>{
    const m=JSON.parse(event.data);
    if(m.type==='ping'){peer.send(JSON.stringify({type:'pong'}));return;}
    if(m.type==='cancel'){const request=requests.get(m.id)??(capture?.request?.id===m.id?capture.request:undefined);if(request?.peer===peer)request.cancelled=true;if(capture?.request===request&&request){const lease=capture;void enqueue(()=>handle('finish_capture',{threadId:lease.threadId,token:lease.token})).catch(()=>{});}return;}
    if(m.type!=='request')return;
    const request={id:m.id,peer,deadline:Math.min(Date.now()+15000,Number.isFinite(m.deadline)?m.deadline:Infinity),cancelled:false,dispatched:false};requests.set(m.id,request);
    void enqueue(async()=>{
      let response;
      try{response={type:'response',id:m.id,result:await handle(m.method,m.args,request)};}
      catch(e){response={type:'response',id:m.id,error:/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'BROWSER_OR_STATE_API_FAILED',details:e.details??{outcome:request.dispatched?'UNKNOWN':'NOT_STARTED',nextAction:'inspect_page_before_retry'}};}
      finally{requests.delete(m.id);}
      if(peer.readyState===WebSocket.OPEN)peer.send(JSON.stringify(response));
    }).catch(error=>{requests.delete(m.id);if(peer.readyState===WebSocket.OPEN)peer.send(JSON.stringify({type:'response',id:m.id,error:'EXTENSION_INITIALIZATION_FAILED'}));});
  };
  peer.onclose=event=>{
    connectionEvent('closed',{code:event.code,reason:event.reason});
    for(const request of requests.values())if(request.peer===peer)request.cancelled=true;
    if(capture?.request?.peer===peer){const lease=capture;void enqueue(()=>handle('finish_capture',{threadId:lease.threadId,token:lease.token})).catch(()=>{});}
    if(reconnectAttempt<6)setTimeout(connect,Math.min(1000*2**reconnectAttempt++,30000));
  };
  peer.onerror=()=>{connectionEvent('error');peer.close();};
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='bridge-reconnect')ready.then(connect).catch(e=>{connectionEvent('initialization_failed',{code:e.message});console.error('Workspace initialization failed:',e.message);});});
chrome.alarms.create('bridge-reconnect',{periodInMinutes:0.5});
chrome.tabs.onCreated.addListener(tab=>{
  void enqueue(async()=>{
    const target=(await chrome.debugger.getTargets()).find(t=>t.tabId===tab.id&&t.type==='page');
    if(!target)return;
    const pending={tabId:tab.id,targetId:target.id,initialGroupId:tab.groupId};
    state.pendingPopups[tab.id]=pending;await save();
    if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'popup',generation:state.generation,...pending}));
  }).catch(()=>{}); // enqueue records the failure and keeps later work usable.
});
chrome.tabs.onRemoved.addListener(tabId=>{
  void enqueue(async()=>{
    for(const threadId of Object.keys(state.workspaces))revoke(threadId,String(tabId),'CLOSED');
    delete state.pendingPopups[tabId];await save();
  }).catch(()=>{});
});
chrome.tabs.onUpdated.addListener((tabId,change)=>{
  if(change.groupId===undefined)return;
  void enqueue(async()=>{
    for(const [threadId,ws] of Object.entries(state.workspaces))if(ws.tabs[tabId])await pages(threadId);
  }).catch(()=>{});
});
ready.then(connect).catch(e=>{connectionEvent('initialization_failed',{code:e.message});console.error('Workspace initialization failed:',e.message);});
