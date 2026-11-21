import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {Controllers,threadTitle} from './identity.js';
import {Bridge,type Page} from './bridge.js';
import {Upstream,PAGE_TOOLS,UpstreamExecutionError} from './upstream.js';
import {leasedPageHandle,inputReferences,outputReferences} from './references.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {checkpoint,operations,OperationError} from './operation.js';
import {VERSION} from './version.js';
import {controllerExited,type ControllerProcess} from './controller-process.js';
import {PageLeases,type ExecutionReceipt,type Lease} from './leases.js';
import type {Journal} from './journal.js';
export interface ExecutionRecovery {root:string;pageId:string;requestId:string;tool:string;lastUsed:number;closePage:boolean;upstreamPid:number}
interface Actor {root:string;detachedAt:number|null;owner?:ControllerProcess;closedAt?:number}
interface Workspace {generation:string;closePending?:string;cleanupDone?:true|'protected-released'}
interface ThreadDirectory {resolveRoot(caller:string):string;displayTitle(root:string,cwd?:string):string}
export const textResult=(value:unknown):CallToolResult=>({content:[{type:'text',text:JSON.stringify(value)}]});
function executionReceipt(error:unknown,root:string,page:Page|undefined,tool:string):ExecutionReceipt|undefined{
  const op=operations.getStore();
  if(error instanceof UpstreamExecutionError&&op&&page){
    return {requestId:op.id,tool,root,tabId:page.tabId,membershipId:page.membershipId,upstream:error.pageExecution};
  }
}
export class Workspaces {
  readonly controllers=new Controllers();
  readonly leases:PageLeases;
  diagnostics(){return {activeThreads:this.controllers.count,leasedTargets:Object.entries(this.leases.snapshot()).filter(([key])=>this.leases.held(key)).map(([key,lease])=>({targetId:key.slice(key.indexOf('/')+1),expiresAt:lease.unknownCheck?.expiresAt??lease.expiresAt,executing:lease.executing,unknown:lease.unknown}))};}
  private records:Record<string,Workspace>={};
  private actors:Record<string,Actor>={};
  private pages=new Map<string,{root:string;generation:string;page:Page}>();
  private queues=new Map<string,Promise<unknown>>();
  private writes=Promise.resolve();private persisted='';private captures=Promise.resolve();
  private titles=new Map<string,{value:string;until:number}>();
  constructor(readonly bridge:Bridge,readonly upstream:Upstream,private stateFile:string,private maxTabs=8,private ttlMs:number|null=null,private title=(thread:string,cwd?:string)=>threadTitle(thread,undefined,cwd),private closedThreadGraceMs:number|null=30000,private threads?:ThreadDirectory,now=()=>Date.now()){this.leases=new PageLeases(now);}
  async load(){
    let initialized=false;
    try{const data=JSON.parse(await readFile(this.stateFile,'utf8'));this.records=data.workspaces??{};this.actors=data.actors??{};initialized=this.leases.load(data.leases);}
    catch(e:any){if(e.code!=='ENOENT')throw e;}
    for(const actor of Object.values(this.actors))actor.detachedAt??=Date.now();
    if(initialized)await this.persist();
  }
  private persist(){
    const data=JSON.stringify({version:2,workspaces:this.records,actors:this.actors,leases:this.leases.snapshot()});
    const write=this.writes.then(async()=>{if(data===this.persisted)return;await mkdir(dirname(this.stateFile),{recursive:true,mode:0o700});await writeFile(this.stateFile+'.tmp',data,{mode:0o600});await rename(this.stateFile+'.tmp',this.stateFile);this.persisted=data;});this.writes=write.catch(()=>{});return write;
  }
  private async lock<T>(key:string,fn:()=>Promise<T>):Promise<T>{const previous=this.queues.get(key)??Promise.resolve();const current=previous.catch(()=>{}).then(()=>{checkpoint();return fn();});this.queues.set(key,current);try{return await current;}finally{if(this.queues.get(key)===current)this.queues.delete(key);}}
  private displayTitle(root:string,cwd?:string){const old=this.titles.get(root);if(old&&old.until>Date.now())return old.value;const value=this.threads?this.threads.displayTitle(root,cwd):this.title(root,cwd);this.titles.set(root,{value,until:Date.now()+2000});return value;}
  private key(root:string,generation:string,page:Page){return `${generation}/${page.targetId}`;}
  private remember(root:string,generation:string,page:Page){const key=this.key(root,generation,page);this.leases.bind(key,`${root}/${page.membershipId}`);this.pages.set(key,{root,generation,page});return key;}
  private handle(root:string,generation:string,page:Page,caller:string){const key=this.remember(root,generation,page);return leasedPageHandle(generation,page.targetId,page.membershipId,this.leases.view(key,caller).version);}
  private async generation(root:string,generation:string){const record=this.records[root];if(record&&record.generation!==generation)throw new Error('WORKSPACE_RESTORE_REQUIRED');if(!record){this.records[root]={generation};await this.persist();}}
  private async listing(root:string){
    const result=await this.bridge.request<{generation:string;pages:Page[];workspace?:any;runtime?:any}>('list',{threadId:root});await this.generation(root,result.generation);
    const current=new Set(result.pages.map(page=>this.remember(root,result.generation,page)));
    for(const [key,known] of this.pages)if(known.root===root&&!current.has(key)){this.pages.delete(key);this.leases.invalidate(key);}
    return result;
  }
  async detach(connection:string){const caller=this.controllers.detach(connection);if(caller&&this.actors[caller]){this.actors[caller].detachedAt=Date.now();await this.persist();}}
  private async known(root:string,caller:string,pageId:string){
    for(const [key,known] of this.pages){
      if(known.root!==root)continue;
      const prefix=leasedPageHandle(known.generation,known.page.targetId,known.page.membershipId,0).slice(0,-1);
      if(!pageId.startsWith(prefix))continue;
      const version=Number(pageId.slice(prefix.length));if(!Number.isSafeInteger(version)||version<1)break;
      let checked;
      try{checked=await this.bridge.request('check',{threadId:root,tabId:known.page.tabId,targetId:known.page.targetId,membershipId:known.page.membershipId});}
      catch(error:any){if(['PAGE_NOT_OWNED','PAGE_REFERENCE_EXPIRED','PAGE_TARGET_CHANGED'].includes(error.message)){this.pages.delete(key);this.leases.invalidate(key);}throw error;}
      if(checked.generation!==known.generation)throw new Error('WORKSPACE_RESTORE_REQUIRED');
      if(checked.page.membershipId!==known.page.membershipId){this.pages.delete(key);this.leases.invalidate(key);throw new Error('PAGE_REFERENCE_EXPIRED');}
      known.page=checked.page;return {key,version,...known};
    }
    throw new OperationError('PAGE_NOT_OWNED',{reason:'PAGE_CLOSED_MOVED_OR_INVALID_REFERENCE',outcome:'NOT_STARTED',nextAction:'list_pages_then_read_fresh_state'});
  }
  async call(connection:string,caller:string,name:string,args:Record<string,any>,owner?:ControllerProcess,clientCwd?:string):Promise<CallToolResult>{
    const root=this.threads?.resolveRoot(caller)??caller;
    if(this.records[root])delete this.records[root].cleanupDone;
    const previous=this.controllers.attach(connection,caller);if(previous&&this.actors[previous])this.actors[previous].detachedAt=Date.now();
    this.actors[caller]={root,owner,detachedAt:null};await this.persist();
    return this.lock('caller:'+caller,async()=>{
      if(this.bridge.extensionVersion&&this.bridge.pageModelVersion!==2)throw new Error('EXTENSION_UPGRADE_REQUIRED');
      if(name==='reset_workspace'){
        if(args.acknowledgeLostPages!==true)throw new Error('RESTORE_ACKNOWLEDGEMENT_REQUIRED');const ping=await this.bridge.request('ping');
        if(this.records[root]?.generation===ping.generation)throw new Error('WORKSPACE_RESTORE_NOT_REQUIRED');
        this.records[root]={generation:ping.generation};await this.persist();return textResult({reset:true});
      }
      if(name==='get_active_tab'){
        const result=await this.bridge.request('get_active_tab');const page=result.page;
        return textResult({page:page?{pageId:`candidate:${result.generation}:${page.targetId}:${page.tabId}`,title:page.title,url:page.url,active:page.active}:null});
      }
      if(name==='list_pages'){
        const {generation,pages,workspace,runtime}=await this.listing(root);
        await this.bridge.request('title',{threadId:root,title:this.displayTitle(root,clientCwd)});
        return textResult({pages:pages.flatMap(page=>{const key=this.remember(root,generation,page),lease=this.leases.view(key,caller);return lease.visible?[{pageId:this.handle(root,generation,page,caller),position:page.position,title:page.title,url:page.url,active:page.active,slot:page.slot,retained:page.retained,canClose:page.canClose,reusable:page.reusable,source:page.source,lease:{status:lease.status,...('expiresAt' in lease?{expiresAt:lease.expiresAt}:{})}}]:[];}),workspace:workspace?{status:workspace.status,groupId:workspace.groupId}: {status:pages.length?'READY':'EMPTY'},runtime:{adapter:VERSION,upstream:'1.11.0',...runtime,cleanup:{enabled:this.closedThreadGraceMs!==null,controllerRegistered:!!owner,graceMs:this.closedThreadGraceMs}}});
      }
      if(name==='open_page'||name==='move_tab_to_workspace')return this.lock('family:'+root,async()=>{
        const current=await this.listing(root),allowedTargetIds=current.pages.filter(page=>this.leases.view(this.key(root,current.generation,page),caller).visible).map(page=>page.targetId);
        let token:ReturnType<PageLeases['begin']>|undefined;
        let result,unknown=false;
        let receipt:ExecutionReceipt|undefined;
        try{
          if(name==='move_tab_to_workspace'){
            const match=/^candidate:([^:]+):([^:]+):(\d+)$/.exec(args.pageId);
            let tabId:number,targetId:string,version:number;
            if(match){if(match[1]!==current.generation)throw new Error('PAGE_REFERENCE_EXPIRED');targetId=match[2];tabId=Number(match[3]);version=this.leases.view(`${current.generation}/${targetId}`,caller).version;}
            else {const known=await this.known(root,caller,args.pageId);tabId=known.page.tabId;targetId=known.page.targetId;version=known.version;}
            token=this.leases.begin(`${current.generation}/${targetId}`,caller,version);await this.persist();
            result=await this.bridge.request('move_tab_to_workspace',{threadId:root,tabId,targetId,title:this.displayTitle(root,clientCwd)});
          }else{
            const existing=current.pages.find(page=>page.slot===(args.slot??'main')&&page.reusable);
            if(existing){const key=this.key(root,current.generation,existing);token=this.leases.begin(key,caller,this.leases.view(key,caller).version);await this.persist();}
            result=await this.bridge.request('open',{threadId:root,slot:args.slot??'main',title:this.displayTitle(root,clientCwd),maxTabs:this.maxTabs,allowedTargetIds});
          }
          await this.generation(root,result.generation);const page:Page=result.page,key=this.key(root,result.generation,page);
          if(name==='move_tab_to_workspace'){
            if(token!.key!==key)throw new OperationError('PAGE_REFERENCE_EXPIRED',{outcome:'UNKNOWN',nextAction:'list_pages_then_read_fresh_state'});
            this.leases.rebind(token!,`${root}/${page.membershipId}`);
          }
          this.remember(root,result.generation,page);
          token??=this.leases.begin(key,caller,this.leases.view(key,caller).version);await this.persist();
          const pageId=leasedPageHandle(result.generation,page.targetId,page.membershipId,token.version);
          if(name==='open_page'&&page.url!==args.url){const map=await this.upstream.mapping([page.targetId]);await this.check(root,result.generation,page);const response=await this.upstream.call('navigate_page',{pageId:map.get(page.targetId),url:args.url},[page.targetId]);if(response.isError)return outputReferences(response,pageId,this.upstream.epoch,map.get(page.targetId)!);}
          const after=await this.check(root,result.generation,page);this.leases.validate(token);
          return textResult({pageId,url:after.page.url,slot:after.page.slot,reused:result.reused,canClose:after.page.canClose});
        }catch(error:any){
          unknown=error.details?.outcome==='UNKNOWN'||/OUTCOME_UNKNOWN|PAGE_CLOSE_PENDING/.test(error.message);
          receipt=executionReceipt(error,root,result?.page,name);
          throw error;
        }
        finally{if(token){this.leases.finish(token,unknown,receipt);if(!result&&token.newGrant&&!unknown)this.leases.release(token.key,caller,token.version);await this.persist();}}
      });
      const known=await this.known(root,caller,args.pageId);
      if(name==='release_page'){this.leases.release(known.key,caller,known.version);await this.persist();return textResult({released:true,pageId:args.pageId});}
      return this.operate(root,caller,known,name,async()=>{
        const page=known.page;
        if(name==='close_page'||name==='set_page_retention'){
          if(name==='close_page'&&page.canClose===false)throw new Error('PAGE_CLOSE_PROTECTED');
          await this.bridge.request(name==='close_page'?'close':'retain',{threadId:root,tabId:page.tabId,targetId:page.targetId,membershipId:page.membershipId,retained:args.retained});
          if(name==='close_page'){this.leases.invalidate(known.key);this.pages.delete(known.key);}return textResult(name==='close_page'?{closed:true,pageId:args.pageId}:{pageId:args.pageId,retained:args.retained});
        }
        if(!(PAGE_TOOLS as readonly string[]).includes(name))throw new Error('TOOL_NOT_ALLOWED');
        const map=await this.upstream.mapping([page.targetId]),epoch=this.upstream.epoch;
        const translated=inputReferences(args,args.pageId,epoch);translated.pageId=map.get(page.targetId);
        const invoke=async()=>{await this.check(root,known.generation,page);checkpoint();return this.upstream.call(name,translated,[page.targetId]);};
        let result;
        if(name==='take_screenshot'){
          const capture=this.captures.catch(()=>{}).then(async()=>{checkpoint();await this.check(root,known.generation,page);const prepared=await this.bridge.request('prepare_capture',{threadId:root,tabId:page.tabId,targetId:page.targetId,membershipId:page.membershipId});try{return await invoke();}finally{await operations.exit(()=>this.bridge.request('finish_capture',{threadId:root,token:prepared.token}));}});this.captures=capture.then(()=>{},()=>{});result=await capture;
        }else result=await invoke();
        await this.check(root,known.generation,page);return outputReferences(result,args.pageId,epoch,map.get(page.targetId)!);
      });
    });
  }
  private async check(root:string,generation:string,page:Pick<Page,'tabId'|'targetId'|'membershipId'>){const checked=await this.bridge.request('check',{threadId:root,tabId:page.tabId,targetId:page.targetId,membershipId:page.membershipId});if(checked.generation!==generation)throw new Error('WORKSPACE_RESTORE_REQUIRED');if(checked.page.membershipId!==page.membershipId)throw new OperationError('PAGE_REFERENCE_EXPIRED',{outcome:'UNKNOWN'});return checked;}
  private async operate(root:string,caller:string,known:{key:string;version:number;generation:string;page:Page},tool:string,fn:()=>Promise<CallToolResult>){
    const token=this.leases.begin(known.key,caller,known.version);let unknown=false;
    let receipt:ExecutionReceipt|undefined;
    try{await this.persist();await this.check(root,known.generation,known.page);const result=await fn();if(this.pages.has(known.key))this.leases.validate(token);return result;}
    catch(error:any){
      unknown=error.details?.outcome==='UNKNOWN'||/OUTCOME_UNKNOWN|PAGE_CLOSE_PENDING/.test(error.message);
      receipt=executionReceipt(error,root,known.page,tool);
      throw error;
    }
    finally{this.leases.finish(token,unknown,receipt);await this.persist();}
  }
  private async confirmUnknownExecution(key:string,lease:Lease,receipt:ExecutionReceipt){
    const [generation,targetId]=key.split('/');
    const membership=`${receipt.root}/${receipt.membershipId}`;
    if(targetId!==receipt.upstream.targetId||lease.membership!==membership)return false;
    try{
      if(!await this.upstream.checkPageExecution(receipt.upstream))return false;
      await this.check(receipt.root,generation,{...receipt,targetId});
      return this.upstream.epoch===receipt.upstream.epoch&&lease.membership===membership;
    }catch{
      return false;
    }
  }
  async checkUnknownExecutions(journal:Journal,now=Date.now()){
    const checks=Object.entries(this.leases.snapshot()).flatMap(([key,lease])=>{
      const check=lease.unknownCheck;
      if(!check||lease.executing||check.expiresAt>now)return [];
      return [{key,lease,check}];
    });
    const results=await Promise.allSettled(checks.map(async ({key,lease,check})=>{
      const receipt=check.receipt;
      const terminated=receipt!==undefined&&await this.confirmUnknownExecution(key,lease,receipt);
      const event=this.leases.completeUnknownCheck(key,check,terminated);
      if(!event)return false;
      await this.persist();
      journal.record({event,requestId:receipt?.requestId,thread:lease.owner,tool:receipt?.tool,outcome:'UNKNOWN'});
      return true;
    }));
    const error=results.find(result=>result.status==='rejected');
    if(error)throw error.reason;
    return results.some(result=>result.status==='fulfilled'&&result.value);
  }
  // Local admin entry only, while the broker maintenance socket is held. It
  // does not attach a controller or impersonate the original lease owner.
  async reconcileExecution(plan:ExecutionRecovery,journal:Journal){
    if((plan.tool!=='open_page'&&!(PAGE_TOOLS as readonly string[]).includes(plan.tool))||plan.tool==='handle_dialog'||typeof plan.closePage!=='boolean')throw new Error('EXECUTION_RECONCILE_INVALID_PLAN');
    return this.lock('family:'+plan.root,async()=>{
      await this.listing(plan.root);
      const known=await this.known(plan.root,plan.root,plan.pageId),row=this.leases.snapshot()[known.key];
      if(!row)throw new Error('EXECUTION_RECONCILE_STATE_CHANGED');
      const token={key:known.key,version:known.version,owner:row.owner},membership=row.membership;
      const validate=()=>{
        this.leases.validate(token);const current=this.leases.snapshot()[known.key];
        if(!current.unknown||current.executing||current.lastUsed!==plan.lastUsed||current.membership!==membership||membership!==`${plan.root}/${known.page.membershipId}`)throw new Error('EXECUTION_RECONCILE_STATE_CHANGED');
      };
      validate();
      const receipt=row.unknownCheck?.receipt;
      if(plan.tool==='open_page'&&!receipt)throw new Error('EXECUTION_RECONCILE_REQUEST_MISMATCH');
      if(receipt&&(receipt.requestId!==plan.requestId||receipt.tool!==plan.tool||receipt.root!==plan.root||receipt.membershipId!==known.page.membershipId||receipt.upstream.targetId!==known.page.targetId))throw new Error('EXECUTION_RECONCILE_REQUEST_MISMATCH');
      if(receipt&&receipt.upstream.epoch!==this.upstream.epoch)throw new Error('EXECUTION_RECONCILE_TRANSPORT_CHANGED');
      const startedAt=receipt?row.lastUsed:journal.unknownRequest(plan.requestId,token.owner,plan.tool,plan.lastUsed).startedAt;
      if(plan.closePage&&known.page.canClose===false)throw new Error('PAGE_CLOSE_PROTECTED');
      const proof=await this.upstream.drainExecution(known.page.targetId,plan.upstreamPid,startedAt);
      await this.check(plan.root,known.generation,known.page);validate();
      this.leases.reconcile(token,plan.lastUsed);await this.persist();
      journal.record({event:'execution_reconciled',requestId:plan.requestId,thread:token.owner,tool:plan.tool,outcome:'UNKNOWN'});await journal.flush();
      let closed=false;
      if(plan.closePage){
        const operation=this.leases.begin(known.key,token.owner,token.version);let unknown=false;
        try{
          await this.persist();await this.check(plan.root,known.generation,known.page);
          await this.bridge.request('close',{threadId:plan.root,tabId:known.page.tabId,targetId:known.page.targetId,membershipId:known.page.membershipId});
          closed=true;this.leases.invalidate(known.key);this.pages.delete(known.key);
        }catch(error:any){unknown=error.details?.outcome==='UNKNOWN'||/OUTCOME_UNKNOWN|PAGE_CLOSE_PENDING/.test(error.message);throw error;}
        finally{this.leases.finish(operation,unknown);await this.persist();}
        this.leases.release(known.key,token.owner,token.version);await this.persist();
      }
      const nativeListPages=await proof.readPages();
      const after=await this.listing(plan.root);
      if(closed&&after.pages.some(page=>page.targetId===known.page.targetId))throw new Error('PAGE_CLOSE_PENDING');
      return {requestId:plan.requestId,originalOutcome:'UNKNOWN',execution:'TERMINATED',terminalEvidence:proof.terminalEvidence,upstreamEpoch:proof.epoch,upstreamPageId:proof.upstreamPageId,pageId:plan.pageId,pageBefore:known.page,closed,released:closed,lease:{...this.leases.snapshot()[known.key]},workspace:after.workspace,nativeListPages};
    });
  }
  async collect(now=Date.now()){
    if(this.ttlMs===null&&this.closedThreadGraceMs===null)return;
    const errors:unknown[]=[];
    for(const root of Object.keys(this.records))try{await this.lock('family:'+root,async()=>{
      const record=this.records[root];
      // Old browser sessions still need explicit reset when a caller resumes.
      // They have no current ownership for background cleanup.
      if(record.generation!==this.bridge.generation||record.cleanupDone==='protected-released')return;
      // A child may be the family's first browser caller. Its exit cannot prove
      // an unregistered root controller has ended; preserve that family.
      if(!this.actors[root])return;
      const actors=new Map(Object.entries(this.actors).filter(([,actor])=>actor.root===root));if(!actors.size)return;
      for(const [caller,actor] of actors){
        if(this.controllers.attached(caller)||actor.detachedAt===null)return;
        if(actor.owner){if(!controllerExited(actor.owner))return;if(actor.closedAt===undefined){actor.closedAt=now;await this.persist();return;}if(this.closedThreadGraceMs!==null&&now-actor.closedAt<this.closedThreadGraceMs)return;}
        else if(this.ttlMs===null||now-actor.detachedAt<this.ttlMs)return;
      }
      // Calls can register a new or replacement actor while a Chrome read is pending.
      const reattached=()=>Object.entries(this.actors).some(([caller,actor])=>actor.root===root&&(actor!==actors.get(caller)||this.controllers.attached(caller)));
      const {generation,pages}=await this.listing(root);
      if(record.closePending&&pages.some(page=>page.targetId===record.closePending))return;delete record.closePending;
      for(const page of pages){
        if(reattached())return;
        const key=this.key(root,generation,page);
        if(page.retained||this.leases.held(key))continue;
        const args={threadId:root,generation,tabId:page.tabId,targetId:page.targetId,membershipId:page.membershipId};
        if(page.canClose===false){
          await this.bridge.request('ungroup',args);
          this.leases.invalidate(key);
          continue;
        }
        try{await this.bridge.request('close',args);this.leases.invalidate(key);}
        catch(error:any){if(error.message!=='BRIDGE_DISCONNECTED')record.closePending=page.targetId;await this.persist();throw error;}
      }
      const remaining=(await this.listing(root)).pages;
      if(!reattached()&&remaining.every(page=>page.retained))record.cleanupDone='protected-released';
      await this.persist();
    });}catch(error){errors.push(error);}
    if(errors.length)throw errors[0];
  }
}
