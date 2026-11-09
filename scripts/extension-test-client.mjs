// Explicit admin/test helper. Official MCP operates only the exact project worker;
// the first read verifies the supplied anchor against its real group and target.
import {upstream} from './upstream-client.mjs';
export async function extensionTestClient(targetId){
 if(!/^[A-F0-9]{32}$/.test(targetId??''))throw Error('OWNED_TEST_TARGET_MISSING');
 const client=await upstream({extensions:true});
 const call=async(name,args)=>{const r=await client.callTool({name,arguments:args},undefined,{timeout:20000});if(r.isError)throw Error(JSON.stringify(r));return r;};
 try{
  const r=await call('list_pages',{});
  const worker=(r.structuredContent.extensionServiceWorkers??[]).find(p=>p.url==='chrome-extension://ncljeojfhgjnlhakfgdkgpalbnhdlgbl/worker.js');
  if(!worker)throw Error('OWNED_TEST_WORKER_MISSING');
  const evaluate=async fn=>{const r=await call('evaluate_script',{serviceWorkerId:worker.id,function:fn,waitForStableDom:false});const text=r.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');const match=text.match(/```json\n([\s\S]*?)\n```/);return match?JSON.parse(match[1]):text;};
  await evaluate(`async()=>{const targetId=${JSON.stringify(targetId)};const {state}=await chrome.storage.session.get('state');const target=(await chrome.debugger.getTargets()).find(t=>t.id===targetId&&t.type==='page');if(!target||!state)throw Error('OWNED_TEST_TARGET_MISSING');const tab=await chrome.tabs.get(target.tabId);if(!Object.values(state.workspaces).some(ws=>ws.groupId===tab.groupId&&ws.tabs[tab.id]?.targetId===targetId))throw Error('OWNED_TEST_TARGET_MISSING');return true;}`);
  return {close:()=>client.close(),evaluate};
 }catch(error){await client.close();throw error;}
}
