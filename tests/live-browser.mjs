// Explicit real-browser acceptance. Identities come from preceding real CLI transcripts.
// Replayed metadata here proves the adapter protocol, not an additional live CLI lifecycle.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const config=process.env.CBW_TEST_CONFIG??fileURLToPath(new URL('.artifacts/dev-config.json',root));
const prefix=process.env.CBW_TEST_PREFIX??'acceptance';
const transcript=async name=>(await readFile(new URL(`.artifacts/${name}-cli.jsonl`,root),'utf8')).trim().split('\n').map(JSON.parse);
const aId=(await transcript(prefix+'-a')).find(x=>x.type==='thread.started').thread_id;
const bId=(await transcript(prefix+'-b')).find(x=>x.type==='thread.started').thread_id;
const metadata=threadId=>({threadId,'x-codex-turn-metadata':{thread_id:threadId,codex_version:'0.162.1'}});
let calls=0;
async function connection(id){
 const client=new Client({name:'cbw-real-browser-acceptance',version:'0.1.0'});
 await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('dist/adapter/src/stdio.js',root)),config],stderr:'pipe'}));
 return {client,id,async raw(name,args={},meta=metadata(id)){calls++;return client.callTool({name,arguments:args,_meta:meta},undefined,{timeout:50000});},async call(name,args={}){const r=await this.raw(name,args);if(r.isError)throw new Error(name+': '+r.content.map(x=>x.text??'').join('\n'));return r;},async json(name,args={}){const r=await this.call(name,args);return JSON.parse(r.content[0].text);}};
}
let a=await connection(aId),b=await connection(bId);
const evidence={layer:'real Chrome + protocol using real CLI IDs',threads:[aId,bId],checks:[],performance:{},screenshots:[]};
const passed=name=>{evidence.checks.push({name,pass:true});console.log('PASS',name);};
const denied=async(p,code)=>{const r=await p;assert.equal(r.isError,true);assert.match(r.content[0].text,new RegExp(code));};
const url='http://127.0.0.1:19228';
try {
 const toolNames=(await a.client.listTools()).tools.map(t=>t.name);
 for(const forbidden of ['new_page','select_page','resize_page','install_extension','performance_start_trace'])assert.ok(!toolNames.includes(forbidden));
 await denied(a.raw('list_pages',{},{}),'THREAD_IDENTITY_UNAVAILABLE');
 for(const c of [a,b]){try{for(const p of (await c.json('list_pages')).pages)await c.call('close_page',{pageId:p.pageId});}catch(e){if(!e.message.includes('WORKSPACE_RESTORE_REQUIRED'))throw e;await c.call('reset_workspace',{acknowledgeLostPages:true});}}
 const originalA=await a.json('open_page',{url:`${url}/cli`});const originalB=await b.json('open_page',{url:`${url}/cli`});
 assert.ok(originalA&&originalB);assert.notEqual(originalA.pageId,originalB.pageId);passed('real CLI-created groups resumed via stdio');
 const duplicate=await connection(aId);await denied(duplicate.raw('list_pages'),'THREAD_ALREADY_ATTACHED');await duplicate.client.close();passed('second controller denied');
 for(const tool of ['evaluate_script','take_screenshot','get_network_request','close_page']){
  const args={pageId:originalB.pageId};if(tool==='evaluate_script')args.function='()=>document.title';if(tool==='get_network_request')args.reqid='forbidden';
  await denied(a.raw(tool,args),'PAGE_NOT_OWNED');
 }
 await denied(a.raw('list_console_messages',{pageId:originalA.pageId,serviceWorkerId:'sw-1'}),'INVALID_TOOL_ARGUMENTS');passed('cross-page tools and worker escape rejected');
 const start=performance.now(),callsBefore=calls;let last;
 for(let i=0;i<20;i++){last=await a.json('open_page',{url:`${url}/visit-${i}`});assert.equal(last.pageId,originalA.pageId);}
 const after=(await a.json('list_pages')).pages;assert.equal(after.length,1);
 evidence.performance={visits:20,toolCalls:calls-callsBefore-1,pagesAfter:after.length,durationMs:Math.round(performance.now()-start)};passed('20 URLs reuse main slot without tab growth');
 const edit=await a.json('open_page',{url:`${url}/edit`,slot:'edit'});
 await a.call('evaluate_script',{pageId:edit.pageId,function:'()=>{document.querySelector("#draft").value="unsaved draft";return true}',waitForStableDom:false});
 await a.json('open_page',{url:`${url}/preview`,slot:'preview'});
 const draft=await a.call('evaluate_script',{pageId:edit.pageId,function:'()=>document.querySelector("#draft").value',waitForStableDom:false});assert.match(draft.content[0].text,/unsaved draft/);passed('separate same-origin edit and preview slots preserve draft');
 const snapB=await b.call('take_snapshot',{pageId:originalB.pageId});
 const textB=snapB.content.map(x=>x.text??'').join('\n');
 const inputB=textB.split('\n').find(x=>x.includes('textbox "Draft"'))?.match(/uid=(\S+)/)?.[1];
 assert.ok(inputB,textB);await denied(a.raw('fill',{pageId:edit.pageId,uid:inputB,value:'wrong'}),'PAGE_NOT_OWNED');
 await b.call('fill',{pageId:originalB.pageId,uid:inputB,value:'B draft'});
 const snap=await b.call('take_snapshot',{pageId:originalB.pageId});const button=snap.content[0].text.split('\n').find(x=>x.includes('button "Increment"')).match(/uid=(\S+)/)[1];
 await b.call('click',{pageId:originalB.pageId,uid:button});const counter=await b.call('evaluate_script',{pageId:originalB.pageId,function:'()=>document.querySelector("#counter").value',waitForStableDom:false});assert.match(counter.content[0].text,/"1"/);passed('page-bound element refs and real fill/click');
 for(const [list,get,key] of [['list_network_requests','get_network_request','reqid'],['list_console_messages','get_console_message','msgid']]){
  const r=await b.call(list,{pageId:originalB.pageId});const match=r.content.map(x=>x.text??'').join('\n').match(new RegExp(key+'=(\\S+)'));
  assert.ok(match,list);await b.call(get,{pageId:originalB.pageId,[key]:match[1]});await denied(a.raw(get,{pageId:edit.pageId,[key]:match[1]}),'PAGE_NOT_OWNED');
 }passed('network and console refs isolated');
 await a.call('set_page_retention',{pageId:edit.pageId,retained:true});assert.equal((await a.json('list_pages')).pages.find(p=>p.pageId===edit.pageId).retained,true);
 const popupSnapshot=await a.call('take_snapshot',{pageId:edit.pageId});
 const popupButton=popupSnapshot.content[0].text.split('\n').find(x=>x.includes('button "Open test popup"')).match(/uid=(\S+)/)[1];
 await a.call('click',{pageId:edit.pageId,uid:popupButton});
 let popup;
 for(let n=0;n<20;n++){popup=(await a.json('list_pages')).pages.find(p=>p.slot.startsWith('popup-'));if(popup)break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(popup);assert.ok(!(await b.json('list_pages')).pages.some(p=>p.pageId===popup.pageId));passed('opener popup joins only its owning thread');
 while((await a.json('list_pages')).pages.length<8){const count=(await a.json('list_pages')).pages.length;await a.json('open_page',{url:`${url}/limit-${count}`,slot:`limit-${count}`});}
 await denied(a.raw('open_page',{url:`${url}/over-limit`,slot:'over-limit'}),'TAB_LIMIT_REACHED');assert.equal((await a.json('list_pages')).pages.length,8);
 await a.call('evaluate_script',{pageId:edit.pageId,function:`()=>{window.open('${url}/excess-popup','_blank');return true}`,waitForStableDom:false});await new Promise(r=>setTimeout(r,300));assert.equal((await a.json('list_pages')).pages.length,8);passed('hard cap including excess owned popups');
 await a.client.close();await new Promise(r=>setTimeout(r,100));a=await connection(aId);
 assert.equal((await a.json('list_pages')).pages.find(p=>p.pageId===edit.pageId).retained,true);passed('disconnect and resume retain workspace and retention');
 for(const p of (await a.json('list_pages')).pages)await a.call('close_page',{pageId:p.pageId});assert.equal((await a.json('list_pages')).pages.length,0);
 const rebuilt=await a.json('open_page',{url:`${url}/rebuilt`});assert.notEqual(rebuilt.pageId,originalA.pageId);passed('close last tab and recreate logical workspace');
 // Screenshot is deliberately last: an upstream timeout must not hide isolation results.
 try{
  await a.call('evaluate_script',{pageId:rebuilt.pageId,function:'async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true}',waitForStableDom:false});
  const shot=await a.call('take_screenshot',{pageId:rebuilt.pageId});const img=shot.content.find(x=>x.type==='image');assert.ok(img);
  await writeFile(new URL('.artifacts/acceptance-final.png',root),Buffer.from(img.data,'base64'));evidence.screenshots.push({pass:true,path:'acceptance-final.png'});passed('official MCP background screenshot');
 }catch(e){evidence.screenshots.push({pass:false,error:e.message});console.log('BLOCKED screenshot',e.message);process.exitCode=1;}
}catch(error){evidence.failure=error.message;console.error(error);process.exitCode=1;}
finally{
 for(const connection of [a,b]){
  try{for(const p of (await connection.json('list_pages')).pages)await connection.call('close_page',{pageId:p.pageId});}catch(e){evidence.cleanupError=e.message;process.exitCode=1;}
  await connection.client.close();
 }
 evidence.totalProtocolCalls=calls;await writeFile(new URL('.artifacts/live-browser-results.json',root),JSON.stringify(evidence,null,2)+'\n');
}
