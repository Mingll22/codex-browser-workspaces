import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ListRootsRequestSchema,type Tool,type CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {checkpoint,operations,dispatched,OperationError} from './operation.js';
import {VERSION} from './version.js';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const PAGE_TOOLS=[
  'navigate_page','take_snapshot','take_screenshot','click','hover','fill','fill_form','drag',
  'press_key','type_text','wait_for','evaluate_script','handle_dialog','emulate',
  'list_network_requests','get_network_request','list_console_messages','get_console_message','upload_file',
] as const;
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
      const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../../upstream/build/src/bin/chrome-devtools-mcp.js',import.meta.url)),`--browser-url=${this.browserURL}`,'--no-usage-statistics','--experimental-structured-content','--page-id-routing'],stderr:'pipe'});
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
    dispatched();
    try{return await client.callTool({name,arguments:{...args,__cbwTargetIds:targetIds,__cbwDeadline:deadline}},undefined,{timeout,signal:op?.signal}) as CallToolResult;}
    catch(e:any){
      // SDK cancellation/timeout must not tear down other threads' healthy transport.
      if(op?.signal.aborted)throw new OperationError('REQUEST_CANCELLED',{outcome:'UNKNOWN',nextAction:'inspect_page_before_retry'});
      if(e.code===-32001)throw new OperationError('UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN',{outcome:'UNKNOWN',nextAction:'inspect_page_before_retry'});
      if(this.client!==client)throw new Error('UPSTREAM_DISCONNECTED_OUTCOME_UNKNOWN');
      throw new OperationError('UPSTREAM_REQUEST_FAILED',{outcome:'UNKNOWN',nextAction:'inspect_page_before_retry'});
    }
  }

  async mapping(targetIds:string[]):Promise<Map<string,number>> {
    if(!targetIds.length)return new Map();
    // Wait only for CDP target discovery, never replay a browser mutation.
    for(let attempt=0;attempt<20;attempt++){
      const r=await this.call('list_pages',{},targetIds);
      if(r.isError)throw new Error('UPSTREAM_MAPPING_FAILED');
      const pages=r.structuredContent?.pages as {id:number;targetId:string}[]|undefined;
      if(!Array.isArray(pages))throw new Error('UPSTREAM_CONTRACT_CHANGED');
      const map=new Map(pages.map(p=>[p.targetId,p.id]));
      if(targetIds.every(id=>map.has(id)))return map;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error('PAGE_GONE');
  }
  async close(){const client=this.client;this.client=undefined;await client?.close();}
}
