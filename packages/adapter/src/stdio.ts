import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {loadConfig} from './config.js';
import {Rpc} from './rpc.js';
import {errorDetails} from './operation.js';
import {VERSION} from './version.js';
const config=await loadConfig(process.argv[2]);
const rpc=new Rpc(config.socket);await rpc.ready;await rpc.call('hello',{cwd:process.cwd(),version:VERSION});
const server=new Server({name:'codex-browser-workspaces',version:VERSION},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:await rpc.call('tools')}));
server.setRequestHandler(CallToolRequestSchema,async (request,extra)=>{
  try{return await rpc.call('call',{name:request.params.name,args:request.params.arguments??{},meta:request.params._meta},{signal:extra.signal});}
  catch(error:any){return {content:[{type:'text',text:JSON.stringify(errorDetails(error))}],structuredContent:{error:errorDetails(error)},isError:true};}
});
const transport=new StdioServerTransport();
transport.onclose=()=>rpc.close();
process.stdin.on('end',()=>rpc.close());
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{rpc.close();process.exit();});
await server.connect(transport);
