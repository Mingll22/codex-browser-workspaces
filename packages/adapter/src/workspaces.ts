import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {Controllers,threadTitle} from './identity.js';
import {Bridge,type Page} from './bridge.js';
import {Upstream,PAGE_TOOLS} from './upstream.js';
import {pageHandle,inputReferences,outputReferences} from './references.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {checkpoint,operations,OperationError} from './operation.js';
import {VERSION} from './version.js';
import {controllerExited,type ControllerProcess} from './controller-process.js';
interface Workspace {generation:string;detachedAt:number|null;owner?:ControllerProcess;closedAt?:number;closePending?:string;cleanupDone?:boolean}
export const textResult=(value:unknown):CallToolResult=>({content:[{type:'text',text:JSON.stringify(value)}]});
export class Workspaces {
  readonly controllers=new Controllers();
  private records:Record<string,Workspace>={};
  private queues=new Map<string,Promise<unknown>>();
  private writes=Promise.resolve();
  private persisted='';
  private captures=Promise.resolve();
  private titles=new Map<string,{value:string;until:number;cwd?:string}>();
  private displayTitle(thread:string,cwd?:string){const old=this.titles.get(thread);if(old&&old.cwd===cwd&&old.until>Date.now())return old.value;const value=this.title(thread,cwd);if(this.titles.size>=200)this.titles.delete(this.titles.keys().next().value!);this.titles.set(thread,{value,until:Date.now()+2000,cwd});return value;}
  constructor(readonly bridge:Bridge,readonly upstream:Upstream,private stateFile:string,private maxTabs=8,private ttlMs:number|null=null,private title=(thread:string,cwd?:string)=>threadTitle(thread,undefined,cwd),private closedThreadGraceMs:number|null=30000){}
  async load(){
    try{this.records=JSON.parse(await readFile(this.stateFile,'utf8')).workspaces;}catch(e:any){if(e.code!=='ENOENT')throw e;}
    for(const record of Object.values(this.records))record.detachedAt??=Date.now();
  }
  private persist(){
    const data=JSON.stringify({version:1,workspaces:this.records});
    const write=this.writes.then(async()=>{if(data===this.persisted)return;await mkdir(dirname(this.stateFile),{recursive:true,mode:0o700});await writeFile(this.stateFile+'.tmp',data,{mode:0o600});await rename(this.stateFile+'.tmp',this.stateFile);this.persisted=data;});
    this.writes=write.catch(()=>{});return write;
  }
  private async lock<T>(thread:string,fn:()=>Promise<T>):Promise<T>{
    const previous=this.queues.get(thread)??Promise.resolve();
    const current=previous.catch(()=>{}).then(()=>{checkpoint();return fn();});this.queues.set(thread,current);
    try{return await current;}finally{if(this.queues.get(thread)===current)this.queues.delete(thread);}
  }
  async detach(connection:string){
    const thread=this.controllers.detach(connection);
    if(thread&&this.records[thread]){this.records[thread].detachedAt=Date.now();await this.persist();}
  }
  private async listing(thread:string){
    const {generation,pages,workspace,runtime}=await this.bridge.request<{generation:string;pages:Page[];workspace?:any;runtime?:any}>('list',{threadId:thread});
    const record=this.records[thread];
    if(record&&record.generation!==generation)throw new Error('WORKSPACE_RESTORE_REQUIRED');
    if(!record){this.records[thread]={generation,detachedAt:null};await this.persist();}
    return {generation,pages,workspace,runtime};
  }
  async call(connection:string,thread:string,name:string,args:Record<string,any>,owner?:ControllerProcess,clientCwd?:string):Promise<CallToolResult>{
    const previous=this.controllers.attach(connection,thread);
    if(previous&&this.records[previous]){this.records[previous].detachedAt=Date.now();await this.persist();}
    return this.lock(thread,async()=>{
      if(name==='reset_workspace'){
        if(args.acknowledgeLostPages!==true)throw new Error('RESTORE_ACKNOWLEDGEMENT_REQUIRED');
        const ping=await this.bridge.request('ping');
        if(this.records[thread]?.generation===ping.generation)throw new Error('WORKSPACE_RESTORE_NOT_REQUIRED');
        this.records[thread]={generation:ping.generation,detachedAt:null};await this.persist();return textResult({reset:true});
      }
      let {generation,pages,workspace,runtime}=await this.listing(thread);
      const record=this.records[thread];
      record.detachedAt=null;record.owner=owner;delete record.closedAt;delete record.closePending;delete record.cleanupDone;await this.persist();
      const title=this.displayTitle(thread,clientCwd);
      if(name!=='open_page')await this.bridge.request('title',{threadId:thread,title});
      if(name==='list_pages')return textResult({pages:pages.map(p=>({pageId:pageHandle(generation,p.targetId),url:p.url,slot:p.slot,retained:p.retained})),workspace:workspace??{status:pages.length?'READY':'EMPTY'},runtime:{adapter:VERSION,upstream:'1.11.0',...runtime,cleanup:{enabled:this.closedThreadGraceMs!==null,controllerRegistered:!!record.owner,graceMs:this.closedThreadGraceMs}}});
      if(name==='open_page'){
        const result=await this.bridge.request('open',{threadId:thread,slot:args.slot??'main',title,maxTabs:this.maxTabs});
        if(result.generation!==generation)throw new Error('WORKSPACE_RESTORE_REQUIRED');
        if(result.reused)await this.bridge.request('title',{threadId:thread,title});
        const page:Page=result.page;
        if(page.url!==args.url){
          const map=await this.upstream.mapping([page.targetId]);
          await this.bridge.request('check',{threadId:thread,tabId:page.tabId,targetId:page.targetId});
          const response=await this.upstream.call('navigate_page',{pageId:map.get(page.targetId),url:args.url},[page.targetId]);
          if(response.isError)return outputReferences(response,pageHandle(generation,page.targetId),this.upstream.epoch,map.get(page.targetId)!);
        }
        const current=await this.bridge.request('check',{threadId:thread,tabId:page.tabId,targetId:page.targetId});
        // Do not remove the window's startup placeholder until navigation and
        // ownership checks have succeeded for the new group's first page.
        const cleanup=await this.bridge.request('finalize_open',{threadId:thread,tabId:page.tabId,targetId:page.targetId,createdGroup:result.createdGroup===true});
        return textResult({pageId:pageHandle(generation,page.targetId),url:current.page.url,slot:page.slot,reused:result.reused,...(cleanup.closedBlankTabs?{closedBlankTabs:cleanup.closedBlankTabs}:{})});
      }
      const page=pages.find(p=>pageHandle(generation,p.targetId)===args.pageId);
      if(!page){const revoked=workspace?.revoked?.find((p:any)=>pageHandle(generation,p.targetId)===args.pageId);throw new OperationError('PAGE_NOT_OWNED',{reason:revoked?.reason??'UNKNOWN_OR_FOREIGN_PAGE',outcome:'NOT_STARTED',nextAction:'list_pages_then_open_page'});}
      if(name==='close_page'||name==='set_page_retention'){
        await this.bridge.request(name==='close_page'?'close':'retain',{threadId:thread,tabId:page.tabId,targetId:page.targetId,retained:args.retained});
        return textResult(name==='close_page'?{closed:true,pageId:args.pageId}:{pageId:args.pageId,retained:args.retained});
      }
      if(!(PAGE_TOOLS as readonly string[]).includes(name))throw new Error('TOOL_NOT_ALLOWED');
      const map=await this.upstream.mapping([page.targetId]);
      const translated=inputReferences(args,args.pageId,this.upstream.epoch);
      translated.pageId=map.get(page.targetId);
      const before=await this.bridge.request('check',{threadId:thread,tabId:page.tabId,targetId:page.targetId});
      if(before.generation!==generation)throw new Error('WORKSPACE_RESTORE_REQUIRED');
      const epoch=this.upstream.epoch;
      const invoke=()=>this.upstream.call(name,translated,[page.targetId]);
      let result;
      if(name==='take_screenshot'){
        // The shared Chrome window has one active tab. Only captures need this
        // lock; other thread-bound page work remains concurrent.
        const capture=this.captures.then(async()=>{
          const prepared=await this.bridge.request('prepare_capture',{threadId:thread,tabId:page.tabId,targetId:page.targetId});
          try{
            if(prepared.generation!==generation)throw new Error('WORKSPACE_RESTORE_REQUIRED');
            return await invoke();
          }finally{
            // Selection restoration is cleanup, including when the caller cancelled.
            await operations.exit(()=>this.bridge.request('finish_capture',{threadId:thread,token:prepared.token}));
          }
        });
        this.captures=capture.then(()=>{},()=>{});
        result=await capture;
      }else result=await invoke();
      const after=await this.bridge.request('check',{threadId:thread,tabId:page.tabId,targetId:page.targetId});
      if(after.generation!==generation)throw new Error('WORKSPACE_RESTORE_REQUIRED');
      return outputReferences(result,args.pageId,epoch,map.get(page.targetId)!);
    });
  }
  async collect(now=Date.now()) {
    if(this.ttlMs===null&&this.closedThreadGraceMs===null)return;
    const errors:string[]=[];
    for(const thread of Object.keys(this.records))try{await this.lock(thread,async()=>{
      const record=this.records[thread];
      if(!record||record.cleanupDone||this.controllers.attached(thread)||record.detachedAt===null)return;
      if(record.owner){
        if(!controllerExited(record.owner)){if(record.closedAt!==undefined){delete record.closedAt;await this.persist();}return;}
        if(this.closedThreadGraceMs!==null){
          if(record.closedAt===undefined){record.closedAt=now;await this.persist();return;}
          if(now-record.closedAt<this.closedThreadGraceMs)return;
        }else if(this.ttlMs===null||now-record.detachedAt<this.ttlMs)return;
      }else if(this.ttlMs===null||now-record.detachedAt<this.ttlMs)return;
      const {pages}=await this.listing(thread);
      // A timed-out close may still be waiting on beforeunload. Query for its
      // eventual removal without replaying the destructive request.
      if(record.closePending&&pages.some(page=>page.targetId===record.closePending))return;
      delete record.closePending;
      for(const page of pages){
        if(this.controllers.attached(thread))return;
        if(!page.retained)try{await this.bridge.request('close',{threadId:thread,tabId:page.tabId,targetId:page.targetId});}
        catch(error:any){if(error.message!=='BRIDGE_DISCONNECTED'){record.closePending=page.targetId;await this.persist();}throw error;}
      }
      if(!this.controllers.attached(thread)){
        if(!(await this.listing(thread)).pages.length)delete this.records[thread];
        else record.cleanupDone=true;
        await this.persist();
      }
    });}catch(error:any){errors.push(`${thread}:${error.message}`);}
    if(errors.length)throw new Error(errors.join('; '));
  }
}
