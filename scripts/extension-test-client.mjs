// Test helper: official MCP only; scoped to one owned target and our exact extension worker.
import {upstream} from './upstream-client.mjs';
export async function extensionTestClient(targetId){
 const client=await upstream({extensions:true,patched:true});
 const call=async(name,args)=>{const r=await client.callTool({name,arguments:{...args,__cbwTargetIds:[targetId],__cbwDeadline:Date.now()+20000}},undefined,{timeout:20000});if(r.isError)throw new Error(JSON.stringify(r));return r;};
 try {
 const r=await call('list_pages',{});
 const page=r.structuredContent.pages.find(p=>p.targetId===targetId);
 const worker=r.structuredContent.extensionServiceWorkers.find(p=>p.url==='chrome-extension://ncljeojfhgjnlhakfgdkgpalbnhdlgbl/worker.js');
 if(!page||!worker)throw new Error('OWNED_TEST_TARGET_MISSING');
 await call('select_page',{pageId:page.id,bringToFront:false});
 return {close:()=>client.close(),async evaluate(fn){const r=await call('evaluate_script',{serviceWorkerId:worker.id,function:fn,waitForStableDom:false});const text=r.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');const match=text.match(/```json\n([\s\S]*?)\n```/);return match?JSON.parse(match[1]):text;}};
 } catch(error) {await client.close();throw error;}
}
