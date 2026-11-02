// Preserve only positively identified live pages during an explicit extension
// upgrade. Uses the official MCP and never exports cookies or pairing secrets.
import {extensionTestClient} from './extension-test-client.mjs';
const targetId=process.argv[2];
if(!/^[A-F0-9]{32}$/.test(targetId??''))throw new Error('Pass a verified owned target ID');
const windowIndex=process.argv.indexOf('--window');
const destination=windowIndex<0?null:Number(process.argv[windowIndex+1]);
if(destination!==null&&!Number.isInteger(destination))throw new Error('Pass a verified default window ID');
const extension=await extensionTestClient(targetId);
try{
 const result=await extension.evaluate(`async()=>{
  const {state}=await chrome.storage.session.get('state');
  if(!state)throw new Error('WORKSPACE_STATE_UNAVAILABLE');
  const destination=${JSON.stringify(destination)};
  const defaultWindow=destination===null?null:await chrome.windows.get(destination);
  if(defaultWindow&&(defaultWindow.type!=='normal'||defaultWindow.incognito))throw new Error('INVALID_DEFAULT_WINDOW');
  const previousActive=defaultWindow&&(await chrome.tabs.query({windowId:destination,active:true}))[0];
  const targets=await chrome.debugger.getTargets(),receipts=[];
  for(const ws of Object.values(state.workspaces))for(const id of Object.keys(ws.tabs)){
   const tab=await chrome.tabs.get(Number(id));
   const target=targets.find(t=>t.tabId===tab.id&&t.type==='page');
   if(!target||tab.groupId!==ws.groupId||tab.windowId!==ws.windowId)throw new Error('WORKSPACE_UPGRADE_TARGET_CHANGED');
   receipts.push({tabId:tab.id,targetId:target.id,groupId:tab.groupId,windowId:tab.windowId});
  }
  if(defaultWindow){
   // Validate whole groups before moving any; never carry ordinary user tabs.
   for(const ws of Object.values(state.workspaces))if(Object.keys(ws.tabs).length){
    const groupTabs=await chrome.tabs.query({groupId:ws.groupId});
    if(groupTabs.some(t=>!ws.tabs[t.id]))throw new Error('WORKSPACE_GROUP_CONTAINS_FOREIGN_TABS');
   }
   for(const ws of Object.values(state.workspaces))if(Object.keys(ws.tabs).length&&ws.windowId!==destination){
    await chrome.tabGroups.move(ws.groupId,{windowId:destination,index:-1});
    const tab=await chrome.tabs.get(Number(Object.keys(ws.tabs)[0]));
    ws.groupId=tab.groupId;ws.windowId=destination;
   }
   state.windowId=destination;
   for(const receipt of receipts){const tab=await chrome.tabs.get(receipt.tabId);receipt.groupId=tab.groupId;receipt.windowId=tab.windowId;}
   if(previousActive)await chrome.tabs.update(previousActive.id,{active:true});
  }
  const windows=[...new Set(receipts.map(r=>r.windowId))];
  if(windows.length>1)throw new Error('WORKSPACE_WINDOW_MIGRATION_REQUIRED');
  await chrome.storage.local.set({workspaceUpgrade:{state,targets:receipts}});
  return {staged:true,generation:state.generation,pages:receipts.length,windows};
 }`);
 console.log(JSON.stringify(result,null,2));
}finally{await extension.close();}
