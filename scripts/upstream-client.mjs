import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
export async function upstream({extensions=false,patched=false}={}) {
 const client=new Client({name:'cbw-development',version:'0.1.0'});
 const entry=fileURLToPath(new URL(patched?'../dist/upstream/build/src/bin/chrome-devtools-mcp.js':'../node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js',import.meta.url));
 const transport=new StdioClientTransport({command:process.execPath,args:[...(!patched?['--import',fileURLToPath(new URL('./upstream-target-metadata.mjs',import.meta.url))]:[]),entry,'--browser-url=http://127.0.0.1:9222','--no-usage-statistics','--experimental-structured-content',...(extensions?['--category-extensions']:[])],stderr:'pipe'});
 transport.stderr?.on('data',()=>{});
 await client.connect(transport);
 return client;
}
