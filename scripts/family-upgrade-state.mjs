// Runs inside only the explicitly identified project extension worker through
// official MCP. This module also supports isolated script-level rollback tests.
export async function stageFamilyState(plan){
 const {state}=await chrome.storage.session.get('state');
 if(!state||!plan?.state||state.generation!==plan.state.generation)throw Error('WORKSPACE_UPGRADE_TARGET_CHANGED');
 const targets=await chrome.debugger.getTargets(),receipts=[];
 const groups=new Set(Object.values(state.workspaces).map(ws=>ws.groupId).filter(id=>id!==null&&id!==undefined));
 for(const groupId of groups)for(const tab of await chrome.tabs.query({groupId})){
  const target=targets.find(target=>target.tabId===tab.id&&target.type==='page');
  if(!target)throw Error('WORKSPACE_UPGRADE_TARGET_CHANGED');
  receipts.push({tabId:tab.id,targetId:target.id,groupId:tab.groupId,windowId:tab.windowId});
 }
 const ordered=rows=>[...rows].sort((a,b)=>a.tabId-b.tabId);
 if(JSON.stringify(ordered(receipts))!==JSON.stringify(ordered(plan.targets)))throw Error('WORKSPACE_UPGRADE_TARGET_CHANGED');
 await chrome.storage.local.set({workspaceUpgrade:{state:plan.state,targets:receipts}});
 // Old releases prefer session state at startup; restoring it is also necessary
 // for an exact rollback after a failed forward migration.
 await chrome.storage.session.set({state:plan.state});
 return {staged:true,generation:state.generation,pages:receipts.length,modelVersion:plan.state.modelVersion??1};
}
