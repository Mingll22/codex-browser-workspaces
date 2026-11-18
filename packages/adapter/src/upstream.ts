import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ListRootsRequestSchema,type Tool,type CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {checkpoint,operations,dispatched,OperationError} from './operation.js';
import {VERSION} from './version.js';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
export const PAGE_TOOLS=[
  'navigate_page','take_snapshot','take_screenshot','click','hover','fill','fill_form','drag',
  'press_key','type_text','wait_for','evaluate_script','handle_dialog','emulate',
  'list_network_requests','get_network_request','list_console_messages','get_console_message','upload_file',
] as const;
// Only tools whose handlers observe page state. evaluate_script is arbitrary code.
const READ_ONLY_TOOLS=new Set(['wait_for','take_snapshot','list_network_requests','get_network_request','list_console_messages','get_console_message']);
export type PageExecution={targetId:string;pageId:number;epoch:string};
export class UpstreamExecutionError extends OperationError {
  constructor(code:string,readonly pageExecution:PageExecution,details:Record<string,unknown>){super(code,details);}
}
export class Upstream {
  epoch=randomUUID();
  private client?:Client;
  private starting?:Promise<Client>;
  private roots=new Set<string>();
  constructor(private browserURL:string){}
  async addRoot(path:string){
    if(this.roots.has(path))return;
    this.roots.add(path);
    try{await this.client?.sendRootsListChanged();}catch(error){this.roots.delete(path);throw error;}
  }
  private async ensure():Promise<Client> {
    if(this.client)return this.client;
    if(this.starting)return this.starting;
    this.starting=(async()=>{
      const client=new Client({name:'codex-browser-workspaces',version:VERSION},{capabilities:{roots:{listChanged:true}}});
      client.setRequestHandler(ListRootsRequestSchema,async()=>({roots:[...this.roots].map(root=>({uri:pathToFileURL(root).href}))}));
      const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../../upstream/build/src/bin/chrome-devtools-mcp.js',import.meta.url)),`--browser-url=${this.browserURL}`,'--no-usage-statistics','--experimental-structured-content','--page-id-routing','--categoryExtensions'],stderr:'pipe'});
      transport.stderr?.on('data',()=>{});
      try{await client.connect(transport);}catch(e){await client.close();throw e;}
      client.onclose=()=>{if(this.client===client){this.client=undefined;this.epoch=randomUUID();}};
      this.client=client;this.epoch=randomUUID();return client;
    })();
    try{return await this.starting;}finally{this.starting=undefined;}
  }
  async tools():Promise<Tool[]> {
    const client=await this.ensure();const {tools}=await client.listTools();
    return PAGE_TOOLS.map(name=>{
      const tool=tools.find(t=>t.name===name);
      if(!tool||!tool.inputSchema.properties?.pageId)throw new Error('UPSTREAM_CONTRACT_CHANGED');
      const schema=structuredClone(tool.inputSchema);
      schema.properties!.pageId={type:'string',description:'Owned workspace pageId returned by open_page/list_pages.'};
      for(const field of ['filePath','sourcePath','serviceWorkerId','__cbwTargetIds','__cbwDeadline'])delete schema.properties![field];
      for(const field of ['reqid','msgid'])if(schema.properties![field])schema.properties![field]={type:'string',description:'Page-bound reference from the corresponding list tool.'};
      schema.required=schema.required?.filter(field=>!['__cbwTargetIds','__cbwDeadline','sourcePath'].includes(field));
      schema.additionalProperties=false;
      return {name,description:tool.description,inputSchema:schema,annotations:tool.annotations};
    });
  }
  async call(name:string,args:Record<string,unknown>,targetIds:string[]):Promise<CallToolResult> {
    checkpoint();const client=await this.ensure();checkpoint();
    const op=operations.getStore();
    const timeout=Math.max(1,Math.min(25000,(op?.deadline??Infinity)-Date.now()));
    const deadline=Date.now()+timeout;
    // Leave time to receive the wait handler's terminal timeout response.
    const input=name==='wait_for'?{...args,timeout:Math.min(Number(args.timeout)||30000,Math.max(1,timeout-1000))}:args;
    // handle_dialog uses a separate queue and cannot be checked with a snapshot.
    const [targetId]=targetIds;
    const pageExecution:PageExecution|undefined=this.client===client&&name!=='handle_dialog'&&
      (PAGE_TOOLS as readonly string[]).includes(name)&&targetIds.length===1&&targetId&&
      typeof input.pageId==='number'&&Number.isSafeInteger(input.pageId)&&input.pageId>0
      ?{targetId,pageId:input.pageId,epoch:this.epoch}:undefined;
    dispatched();
    try{return await client.callTool({name,arguments:{...input,__cbwTargetIds:targetIds,__cbwDeadline:deadline}},undefined,{timeout,signal:op?.signal}) as CallToolResult;}
    catch(e:any){
      // Keep the lease executing until this independent bounded read drain finishes.
      if(pageExecution&&READ_ONLY_TOOLS.has(name)&&await this.probePageExecution(pageExecution,20000)){
        throw new OperationError('UPSTREAM_READ_FAILED',{outcome:'FAILED',terminalEvidence:'same_page_snapshot_completed',nextAction:'read_fresh_page_state'});
      }
      // SDK cancellation/timeout must not tear down other threads' healthy transport.
      const code=op?.signal.aborted?'REQUEST_CANCELLED':
        e?.code===-32001?'UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN':
        this.client!==client?'UPSTREAM_DISCONNECTED_OUTCOME_UNKNOWN':'UPSTREAM_REQUEST_FAILED';
      const details={outcome:'UNKNOWN',nextAction:'wait_3_minutes_then_list_pages'};
      if(pageExecution)throw new UpstreamExecutionError(code,pageExecution,details);
      throw new OperationError(code,details);
    }
  }

  async checkPageExecution(execution:PageExecution):Promise<boolean> {
    return this.probePageExecution(execution,10000);
  }
  private async probePageExecution({targetId,pageId,epoch}:PageExecution,timeout:number):Promise<boolean> {
    // Only the original upstream client owns the original per-page mutex.
    const client=this.client;
    if(!client||this.epoch!==epoch||!targetId||!Number.isSafeInteger(pageId)||pageId<1)return false;
    try{
      const result=await client.callTool({
        name:'take_snapshot',
        arguments:{pageId,__cbwTargetIds:[targetId],__cbwDeadline:Date.now()+timeout},
      },undefined,{timeout});
      return this.client===client&&this.epoch===epoch&&!result.isError;
    }catch{return false;}
  }

  async mapping(targetIds:string[]):Promise<Map<string,number>> {
    if(!targetIds.length)return new Map();
    // Wait only for CDP target discovery, never replay a browser mutation.
    for(let attempt=0;attempt<20;attempt++){
      const r=await this.call('list_pages',{},targetIds);
      if(r.isError)throw new Error('UPSTREAM_MAPPING_FAILED');
      const content=r.structuredContent;
      if(!content||typeof content!=='object'||Array.isArray(content))throw new Error('UPSTREAM_CONTRACT_CHANGED');
      for(const field of ['pages','extensionPages'])if(content[field]!==undefined&&!Array.isArray(content[field]))throw new Error('UPSTREAM_CONTRACT_CHANGED');
      const pages=[...(Array.isArray(content.pages)?content.pages:[]),...(Array.isArray(content.extensionPages)?content.extensionPages:[])] as {id:number;targetId:string}[];
      const map=new Map(pages.filter(p=>targetIds.includes(p.targetId)).map(p=>[p.targetId,p.id]));
      if(targetIds.every(id=>map.has(id)))return map;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error('PAGE_GONE');
  }
  async drainExecution(targetId:string,expectedPid:number,requestStartedAt:number){
    // Never ensure/reconnect: only the original process owns the old page mutex.
    const client=this.client,epoch=this.epoch;
    if(!client)throw new Error('EXECUTION_RECONCILE_TRANSPORT_MISSING');
    const pid=(client.transport as StdioClientTransport)?.pid;
    if(!pid||pid!==expectedPid)throw new Error('EXECUTION_RECONCILE_TRANSPORT_CHANGED');
    const startedAt=Date.parse(execFileSync('ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8',env:{...process.env,LC_ALL:'C'}}).trim());
    if(!Number.isFinite(startedAt)||startedAt>=requestStartedAt)throw new Error('EXECUTION_RECONCILE_TRANSPORT_CHANGED');
    const current=()=>{if(this.client!==client||this.epoch!==epoch)throw new Error('EXECUTION_RECONCILE_TRANSPORT_CHANGED');};
    const call=async(name:string,args:Record<string,unknown>)=>{
      current();const result=await client.callTool({name,arguments:{...args,__cbwTargetIds:[targetId],__cbwDeadline:Date.now()+20000}},undefined,{timeout:20000});current();
      if(result.isError)throw new Error('EXECUTION_RECONCILE_UNPROVEN');return result;
    };
    const before=await call('list_pages',{}),data=before.structuredContent as any;
    const pages=[...(data?.pages??[]),...(data?.extensionPages??[])].filter((p:any)=>p.targetId===targetId);
    if(pages.length!==1||!Number.isSafeInteger(pages[0].id))throw new Error('EXECUTION_RECONCILE_TARGET_CHANGED');
    await call('take_snapshot',{pageId:pages[0].id});
    return {epoch,upstreamPageId:pages[0].id,terminalEvidence:'same_original_process_page_snapshot_completed',readPages:()=>call('list_pages',{})};
  }
  async close(){const client=this.client;this.client=undefined;await client?.close();}
}
