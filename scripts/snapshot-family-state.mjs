#!/usr/bin/env node
// Admin-only snapshot helper. An exact owned anchor gates worker inspection.
import {writeFile} from 'node:fs/promises';
import {extensionTestClient} from './extension-test-client.mjs';
const [targetId,output]=process.argv.slice(2);
if(!output)throw Error('Use OWNED_TARGET_ID output.json');
const extension=await extensionTestClient(targetId);
try{
 const snapshot=await extension.evaluate(`async()=>{const {state}=await chrome.storage.session.get('state');if(!state)throw Error('WORKSPACE_STATE_UNAVAILABLE');const targets=await chrome.debugger.getTargets(),receipts=[];const groups=new Set(Object.values(state.workspaces).map(ws=>ws.groupId).filter(id=>id!==null&&id!==undefined));for(const groupId of groups)for(const tab of await chrome.tabs.query({groupId})){const target=targets.find(t=>t.tabId===tab.id&&t.type==='page');if(!target)throw Error('WORKSPACE_UPGRADE_TARGET_CHANGED');receipts.push({tabId:tab.id,targetId:target.id,groupId:tab.groupId,windowId:tab.windowId});}return {state,targets:receipts};}`);
 await writeFile(output,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({snapshot:output,pages:snapshot.targets.length,runtimeChanged:false}));
}finally{await extension.close();}
