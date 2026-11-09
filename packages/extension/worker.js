import {config} from './config.js';
import {badgeForStatus,StatusError} from './status.js';
import {PageSource,WorkspaceStatus} from './contracts.js';
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
  if(workspaceUpgrade){
    // Explicit admin upgrade only: never restore ownership across a browser
    // session or infer it from a title, URL, or recycled numeric tab ID.
    const targets=await chrome.debugger.getTargets();
    for(const receipt of workspaceUpgrade.targets){
      const tab=await chrome.tabs.get(receipt.tabId);
      if(tab.groupId!==receipt.groupId||tab.windowId!==receipt.windowId||!targets.some(t=>t.tabId===tab.id&&t.id===receipt.targetId))throw new Error('WORKSPACE_UPGRADE_TARGET_CHANGED');
    }
  }
  state=workspaceUpgrade?.state??initial.state??{generation:crypto.randomUUID(),workspaces:{}};
  state.pendingPopups??={};
  if(!Object.keys(state.workspaces).length)state.modelVersion=2;
  state.protectedTargets??={};
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
async function pageTarget(tabId){
  // Chrome's debugger API exposes no per-tab getTarget operation.
  const target=(await chrome.debugger.getTargets()).find(t=>t.tabId===tabId&&t.type==='page');
  if(!target)fail('PAGE_MAPPING_UNAVAILABLE');
  return target.id;
}
function describePage(ws,tab,targetId,position){
  let record=ws.tabs[tab.id];
  if(record?.targetId&&record.targetId!==targetId)record=undefined;
  if(!record){
    record={targetId,slot:null,retained:false,source:PageSource.EXTERNAL,protected:true};
    state.protectedTargets[targetId]=true;
    ws.tabs[tab.id]=record;
  }
  record.targetId=targetId;
  record.source??=PageSource.MANAGED;
  record.membershipId??=crypto.randomUUID();
  record.protected=Boolean(record.protected||state.protectedTargets[targetId]);
  return {tabId:tab.id,targetId,title:tab.title??'',url:tab.url??'',active:Boolean(tab.active),
    groupId:tab.groupId,windowId:tab.windowId,...(position===undefined?{}:{position}),
    membershipId:record.membershipId,source:record.source,protected:record.protected,canClose:!record.protected,
    reusable:!record.protected&&record.source===PageSource.MANAGED,retained:Boolean(record.retained),slot:record.slot??null};
}
async function pages(threadId) {
  const ws=state.workspaces[threadId];
  if(!ws||ws.groupId===null||ws.groupId===undefined)return [];
  const tabs=(await chrome.tabs.query({groupId:ws.groupId})).sort((a,b)=>a.index-b.index);
  const targets=tabs.length?await chrome.debugger.getTargets():[];
  const result=tabs.map((tab,index)=>{
    const target=targets.find(t=>t.tabId===tab.id&&t.type==='page');
    if(!target)fail('PAGE_MAPPING_UNAVAILABLE');
    ws.windowId=tab.windowId;
    return describePage(ws,tab,target.id,index+1);
  });
  for(const key of Object.keys(ws.tabs))if(!tabs.some(tab=>tab.id===Number(key)))revoke(threadId,key,'LEFT_GROUP');
  await save();return result;
}
async function checkedPage(args){
  const ws=state.workspaces[args.threadId];
  if(!ws||ws.groupId===null||ws.groupId===undefined)missingPage(args.threadId,args.targetId);
  // Read exactly the requested tab and verify its real group; checking one
  // page never enumerates unrelated windows, tabs or workspaces.
  const tab=await chrome.tabs.get(args.tabId).catch(error=>{
    if(/No tab with id|Invalid tab ID/i.test(error.message))missingPage(args.threadId,args.targetId);
    throw error;
  });
  if(tab.groupId!==ws.groupId){revoke(args.threadId,String(tab.id),'LEFT_GROUP');await save();missingPage(args.threadId,args.targetId);}
  const targetId=await pageTarget(tab.id);
  if(targetId!==args.targetId)missingPage(args.threadId,args.targetId);
  ws.windowId=tab.windowId;
  const page=describePage(ws,tab,targetId);
  if(args.membershipId&&args.membershipId!==page.membershipId)missingPage(args.threadId,args.targetId);
  await save();return page;
}
async function workspaceGroup(ws){
  if(ws?.groupId===null||ws?.groupId===undefined)return undefined;
  try{return await chrome.tabGroups.get(ws.groupId);}
  catch(error){if(/No group with id|Invalid (tab )?group ID/i.test(error.message))return undefined;throw error;}
}
async function verifyClosed(tabId){
  try{await chrome.tabs.get(tabId);}
  catch(error){if(/No tab with id|Invalid tab ID/i.test(error.message))return;throw error;}
  const error=new Error('PAGE_CLOSE_PENDING');error.details={outcome:'UNKNOWN',nextAction:'inspect_page_before_retry'};throw error;
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
  if(method!=='ping'&&state.modelVersion!==2)fail('WORKSPACE_FAMILY_MIGRATION_REQUIRED');
  if(method==='finalize_open'){
    await checkedPage(args);
    return {generation:state.generation,closedBlankTabs:0};
  }
  if(method==='get_active_tab'){
    const window=await chrome.windows.getLastFocused({windowTypes:['normal']});
    if(window.incognito||window.type!=='normal')fail('WORKSPACE_WINDOW_UNAVAILABLE');
    const tabs=await chrome.tabs.query({windowId:window.id,active:true});
    if(tabs.length!==1)fail('ACTIVE_TAB_UNAVAILABLE');
    const tab=tabs[0],targetId=await pageTarget(tab.id);
    return {generation:state.generation,page:{tabId:tab.id,targetId,title:tab.title??'',url:tab.url??'',active:true,groupId:tab.groupId,windowId:tab.windowId}};
  }
  if(method==='move_tab_to_workspace'){
    let ws=state.workspaces[args.threadId];
    if(!ws)ws=state.workspaces[args.threadId]={tabs:{},groupId:null};
    let tab=await chrome.tabs.get(args.tabId);
    if(await pageTarget(tab.id)!==args.targetId)fail('PAGE_TARGET_CHANGED');
    const window=await chrome.windows.get(tab.windowId);
    if(window.incognito||window.type!=='normal')fail('WORKSPACE_WINDOW_UNAVAILABLE');
    for(const [threadId,other] of Object.entries(state.workspaces)){
      if(threadId!==args.threadId&&other.groupId!==null&&tab.groupId===other.groupId)fail('PAGE_IN_ANOTHER_WORKSPACE');
    }
    const group=await workspaceGroup(ws);
    const already=Boolean(group&&tab.groupId===group.id);
    // External protection is attached to stable target identity, before moving.
    if(!already){state.protectedTargets[args.targetId]=true;ws.tabs[tab.id]={targetId:args.targetId,source:PageSource.EXTERNAL,protected:true,slot:null,retained:false};await save();}
    if(!already){
      if(group&&tab.windowId!==group.windowId){await mutate(()=>chrome.tabs.move(tab.id,{windowId:group.windowId,index:-1}));tab=await chrome.tabs.get(tab.id);}
      ws.groupId=await mutate(()=>chrome.tabs.group(group?{tabIds:tab.id,groupId:group.id}:{tabIds:tab.id,createProperties:{windowId:tab.windowId}}));
      ws.windowId=group?.windowId??tab.windowId;
      await save();
      if(!group)await mutate(()=>chrome.tabGroups.update(ws.groupId,{title:args.title,color:colorFor(ws)}));
    }
    await mutate(()=>chrome.tabs.update(tab.id,{active:true}));
    return {generation:state.generation,page:await checkedPage(args),reused:already,createdGroup:!group};
  }
  if(method==='adopt_popup') {
    if(args.generation!==state.generation)fail('WORKSPACE_RESTORE_REQUIRED');
    const pending=state.pendingPopups[args.tabId];
    if(!pending||pending.targetId!==args.targetId)return {};
    const target=(await chrome.debugger.getTargets()).find(t=>t.tabId===args.tabId);
    if(!target||target.id!==args.targetId){delete state.pendingPopups[args.tabId];await save();return {};}
    const tab=await chrome.tabs.get(args.tabId);
    if(tab.groupId===-1&&tab.groupId===pending.initialGroupId&&args.openerTargetId){
      for(const [threadId,ws] of Object.entries(state.workspaces)){
        const own=await pages(threadId);
        if(!own.some(p=>p.targetId===args.openerTargetId))continue;
        if(own.some(p=>p.tabId===args.tabId))break;
        if(own.length>=(ws.maxTabs??8)){
          // A user-moved/grouped tab is never a disposable popup.
          const current=await chrome.tabs.get(args.tabId);
          if(current.groupId===-1&&!state.protectedTargets[args.targetId]&&await pageTarget(current.id)===args.targetId){await removeOwnedTab(args.tabId);await verifyClosed(args.tabId);}
        }
        else {
          await mutate(()=>chrome.tabs.group({tabIds:args.tabId,groupId:ws.groupId}));
          ws.tabs[args.tabId]={slot:`popup-${args.tabId}`,retained:false,targetId:args.targetId,source:PageSource.POPUP,protected:false};event('popup_adopted',threadId,{tabId:args.tabId,groupId:ws.groupId});
        }
        break;
      }
    }
    delete state.pendingPopups[args.tabId];await save();return {};
  }
  if(method==='ping')return {generation:state.generation,version:chrome.runtime.getManifest().version};
  if(method==='list'){
    const own=await pages(args.threadId),ws=state.workspaces[args.threadId];
    const group=await workspaceGroup(ws);
    return {generation:state.generation,pages:own,workspace:{status:own.length?WorkspaceStatus.READY:group?WorkspaceStatus.GROUP_PRESENT:WorkspaceStatus.EMPTY,groupId:group?.id??null,nextAction:own.length?'use_owned_page':'open_page',revoked:ws?.revoked??[],events:(state.events??[]).filter(e=>e.threadId===args.threadId).slice(-12)},runtime:{extension:chrome.runtime.getManifest().version}};
  }
  if(method==='open') {
    let ws=state.workspaces[args.threadId];
    if(!ws)ws=state.workspaces[args.threadId]={tabs:{},groupId:null};
    const current=await pages(args.threadId);
    const existing=current.find(p=>p.slot===args.slot&&p.reusable);
    if(existing&&args.allowedTargetIds&&!args.allowedTargetIds.includes(existing.targetId))fail('PAGE_LEASE_BUSY');
    if(existing)return {generation:state.generation,page:existing,reused:true};
    if(current.length>=args.maxTabs)fail('TAB_LIMIT_REACHED');
    ws.maxTabs=args.maxTabs;
    let tab;
    const windows=(await chrome.windows.getAll({windowTypes:['normal']})).filter(w=>!w.incognito);
    const group=await workspaceGroup(ws);
    let window=windows.find(w=>w.id===(group?.windowId??state.windowId));
    if(!window&&windows.length){
      // Bind once to the browser's existing default/last-used normal window.
      // A window selection grants no ownership over its existing tabs.
      window=await chrome.windows.getLastFocused({windowTypes:['normal']});
      if(!windows.some(w=>w.id===window.id))fail('WORKSPACE_WINDOW_UNAVAILABLE');
      state.windowId=window.id;
    }
    // Page ownership can be empty while ordinary user tabs keep the bound
    // group alive. Reuse that exact group, never a title/color match.
    if(group)ws.windowId=group.windowId;
    if(window){
      tab=await mutate(()=>chrome.tabs.create({url:'about:blank',active:false,windowId:window.id}));
    }else{
      if(Object.values(state.workspaces).some(w=>Object.keys(w.tabs).length))fail('WORKSPACE_WINDOW_CHANGED');
      const window=await mutate(()=>chrome.windows.create({url:'about:blank',focused:false,type:'normal'}));
      tab=window.tabs[0];state.windowId=window.id;
    }
    ws.windowId=tab.windowId;
    let createdTargetId,assignedGroupId;
    try {
      createdTargetId=await pageTarget(tab.id);
      const groupId=await mutate(()=>chrome.tabs.group(group ? {tabIds:tab.id,groupId:group.id} : {tabIds:tab.id,createProperties:{windowId:ws.windowId}}));
      assignedGroupId=groupId;ws.groupId=groupId;event(group?'group_reused':'group_created',args.threadId,{groupId,tabId:tab.id});
      ws.tabs[tab.id]={slot:args.slot,retained:false,source:PageSource.MANAGED,protected:false};
      await save();
      await mutate(()=>chrome.tabGroups.update(groupId,group?{title:args.title}:{title:args.title,color:colorFor(ws)}));
      await save();
      const page=(await pages(args.threadId)).find(p=>p.tabId===tab.id);
      if(!page)missingPage(args.threadId,ws.tabs[tab.id]?.targetId);
      return {generation:state.generation,page,reused:false,createdGroup:!group};
    } catch(e) {
      // Cancellation stops forward work, but must not strand our newly created
      // tab. Rollback has its own bounded close and exact target/group checks.
      const request=activeRequest;activeRequest=undefined;
      try {
        const current=await chrome.tabs.get(tab.id),record=ws.tabs[tab.id];
        if(createdTargetId&&await pageTarget(tab.id)===createdTargetId&&
           current.groupId===(assignedGroupId??-1)&&!record?.protected&&!state.protectedTargets[createdTargetId]){
          await removeOwnedTab(tab.id);await verifyClosed(tab.id);delete ws.tabs[tab.id];
        }
      }finally{activeRequest=request;}
      await save();throw e;
    }
  }
  if(method==='title') {
    const group=await workspaceGroup(state.workspaces[args.threadId]);
    if(group&&group.title!==args.title)await mutate(()=>chrome.tabGroups.update(group.id,{title:args.title}));
    return {};
  }
  if(method==='prepare_capture') {
    const page=await checkedPage(args);
    const ws=state.workspaces[args.threadId];
    if(capture)fail('CAPTURE_ALREADY_IN_PROGRESS');
    const tabs=await chrome.tabs.query({windowId:page.windowId,active:true});
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
    capture={request:activeRequest,token:crypto.randomUUID(),threadId:args.threadId,tabId:page.tabId,windowId:page.windowId,groupId:ws.groupId,collapsed:group.collapsed,previous};
    const lease=capture;
    captureTimer=setTimeout(()=>{if(capture===lease)void enqueue(()=>handle('finish_capture',{threadId:lease.threadId,token:lease.token})).catch(()=>{});},45000);captureTimer?.unref?.();
    return {generation:state.generation,page,token:capture.token};
  }
  if(method==='finish_capture'){
    if(!capture||capture.token!==args.token||capture.threadId!==args.threadId)fail('CAPTURE_NOT_OWNED');
    const lease=capture;capture=undefined;clearTimeout(captureTimer);captureTimer=undefined;
    const tabs=await chrome.tabs.query({windowId:lease.windowId,active:true});
    if(tabs.find(t=>t.active)?.id===lease.tabId&&lease.previous){
      const targets=await chrome.debugger.getTargets();
      if(targets.some(p=>p.tabId===lease.previous.tabId&&p.id===lease.previous.targetId)){
        await mutate(()=>chrome.tabs.update(lease.previous.tabId,{active:true}));
        if(lease.collapsed&&lease.previous.groupId!==lease.groupId)await mutate(()=>chrome.tabGroups.update(lease.groupId,{collapsed:true}));
      }
    }
    return {generation:state.generation};
  }
  if(method==='close'||method==='retain'||method==='check') {
    const own=await checkedPage(args);
    if(method==='close') {
      if(!own.canClose)fail('PAGE_CLOSE_PROTECTED');
      await removeOwnedTab(own.tabId);
      await verifyClosed(own.tabId);
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
  peer.onopen=()=>{connectionEvent('open');reconnectAttempt=0;peer.send(JSON.stringify({type:'hello',token:config.token,generation:state.generation,version:chrome.runtime.getManifest().version,pageModelVersion:2}));for(const pending of Object.values(state.pendingPopups))peer.send(JSON.stringify({type:'popup',generation:state.generation,...pending}));};
  peer.onmessage=event=>{
    const m=JSON.parse(event.data);
    if(m.type==='status'){void receiveStatus(m.data).catch(error=>{lastStatusError=StatusError.INVALID;statusWaiter?.resolve();void updateBadge();});return;}
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
    connectionEvent('closed',{code:event.code,reason:event.reason});void updateBadge();statusWaiter?.resolve();
    for(const request of requests.values())if(request.peer===peer)request.cancelled=true;
    if(capture?.request?.peer===peer){const lease=capture;void enqueue(()=>handle('finish_capture',{threadId:lease.threadId,token:lease.token})).catch(()=>{});}
    if(reconnectAttempt<6)setTimeout(connect,Math.min(1000*2**reconnectAttempt++,30000));
  };
  peer.onerror=()=>{connectionEvent('error');peer.close();};
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='bridge-reconnect')ready.then(()=>{void updateBadge();connect();}).catch(e=>{connectionEvent('initialization_failed',{code:e.message});console.error('Workspace initialization failed:',e.message);});});
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
    for(const [threadId,ws] of Object.entries(state.workspaces)){
      const targetId=ws.tabs[tabId]?.targetId;
      if(targetId)delete state.protectedTargets[targetId];
      revoke(threadId,String(tabId),'CLOSED');
    }
    delete state.pendingPopups[tabId];await save();
  }).catch(()=>{});
});
// Membership reads are authoritative even if Chrome events are missed or the
// service worker was suspended. Group removal never proves its tabs closed.
chrome.tabs.onUpdated.addListener((tabId,change)=>{
  if(change.groupId===undefined)return;
  // Events may wait behind a move which establishes a new membership. Bind
  // each departure to the membership that existed when Chrome emitted it.
  const memberships=Object.entries(state?.workspaces??{}).map(([threadId,ws])=>[threadId,ws.tabs[tabId]?.membershipId]);
  void enqueue(async()=>{
    for(const [threadId,membershipId] of memberships){
      const ws=state.workspaces[threadId],record=ws?.tabs[tabId];
      if(record&&record.membershipId===membershipId&&ws.groupId!==change.groupId)revoke(threadId,String(tabId),'LEFT_GROUP');
    }
    const tab=await chrome.tabs.get(tabId);
    for(const ws of Object.values(state.workspaces))if(ws.groupId===tab.groupId){
      ws.windowId=tab.windowId;describePage(ws,tab,await pageTarget(tabId));
    }
    await save();
  }).catch(()=>{});
});
ready.then(()=>{void updateBadge();connect();}).catch(e=>{connectionEvent('initialization_failed',{code:e.message});console.error('Workspace initialization failed:',e.message);});

// Read-only toolbar UI. Counts come from the authenticated broker and real
// group queries; opening the popup never acquires or renews a page lease.
let brokerStatus;
let statusWaiter;
let lastStatusError;
const popupPorts=new Set();
chrome.runtime.onConnect?.addListener(port=>{
  if(port.name!=='cbw:popup'||port.sender?.id!==chrome.runtime.id)return;
  popupPorts.add(port);port.onDisconnect.addListener(()=>popupPorts.delete(port));
});
function statusConnection(){if(lastStatusError||state?.modelVersion!==2)return 'ERROR';if(socket?.readyState!==WebSocket.OPEN||!brokerStatus)return 'DISCONNECTED';return Date.now()-brokerStatus.observedAt<65000?'CONNECTED':'STALE';}
async function updateBadge(){
  if(!chrome.action)return;
  const status={...brokerStatus,connection:statusConnection()};
  const badge=badgeForStatus(status);
  await Promise.all([chrome.action.setBadgeText({text:badge.text}),chrome.action.setBadgeBackgroundColor({color:badge.color}),chrome.action.setTitle({title:badge.title})]);
}
async function receiveStatus(data){
  if(!data||!Number.isFinite(data.observedAt)||!Number.isSafeInteger(data.mcpConnections)||data.mcpConnections<0||!Number.isSafeInteger(data.activeThreads)||data.activeThreads<0||!Array.isArray(data.leasedTargets))throw Error(StatusError.INVALID);
  brokerStatus=data;lastStatusError=undefined;statusWaiter?.resolve();await updateBadge();
  if(popupPorts.size)chrome.runtime.sendMessage?.({type:'cbw:status',status:await uiStatus(false)}).catch(()=>{});
}
async function uiStatus(refresh=false){
  await ready;
  if(refresh&&socket?.readyState===WebSocket.OPEN){
    if(!statusWaiter){
      let resolve;const promise=new Promise(r=>resolve=r);
      const timer=setTimeout(()=>{lastStatusError=StatusError.TIMEOUT;resolve();},3000);
      statusWaiter={resolve,promise:promise.finally(()=>{clearTimeout(timer);statusWaiter=undefined;})};
      socket.send(JSON.stringify({type:'status_request'}));
    }
    await statusWaiter.promise;
  }
  const connected=socket?.readyState===WebSocket.OPEN&&!!brokerStatus;
  const fresh=connected&&Date.now()-brokerStatus.observedAt<65000;
  const error=state.modelVersion!==2?StatusError.MIGRATION:lastStatusError;
  const result={connection:statusConnection(),observedAt:brokerStatus?.observedAt??null,extensionVersion:chrome.runtime.getManifest().version,brokerVersion:brokerStatus?.brokerVersion,mcpConnections:brokerStatus?.mcpConnections??null,activeThreads:brokerStatus?.activeThreads??null,workspaces:[],...(error?{error}:{})};
  // Serialize only the short Chrome metadata read, never the network wait.
  return enqueue(async()=>{
    const targets=await chrome.debugger.getTargets();
    for(const ws of Object.values(state.workspaces)){
      const group=await workspaceGroup(ws);if(!group)continue;
      const tabs=await chrome.tabs.query({groupId:group.id});if(!tabs.length)continue;
      const targetIds=tabs.map(tab=>targets.find(target=>target.tabId===tab.id&&target.type==='page')?.id);
      const leasedPages=targetIds.filter(targetId=>brokerStatus?.leasedTargets.some(lease=>lease.targetId===targetId&&(lease.unknown||lease.executing||lease.expiresAt>Date.now()))).length;
      const protectedPages=tabs.filter((tab,index)=>!ws.tabs[tab.id]||ws.tabs[tab.id].protected||state.protectedTargets[targetIds[index]]).length;
      result.workspaces.push({groupId:group.id,title:group.title,pageCount:tabs.length,leasedPages:fresh?leasedPages:null,protectedPages});
    }
    return result;
  });
}
chrome.runtime.onMessage?.addListener((message,sender,respond)=>{
  if(message?.type!=='cbw:get_status'||sender.id!==chrome.runtime.id)return;
  void uiStatus(message.refresh===true).then(respond,error=>respond({connection:'ERROR',observedAt:brokerStatus?.observedAt??null,extensionVersion:chrome.runtime.getManifest().version,mcpConnections:null,activeThreads:null,workspaces:[],error:StatusError.BROWSER_QUERY}));
  return true;
});
