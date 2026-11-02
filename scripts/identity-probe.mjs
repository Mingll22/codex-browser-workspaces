import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
const log=process.argv[2];
const record=x=>appendFileSync(log,JSON.stringify(x)+'\n',{mode:0o600});
record({event:'startup',thread:process.env.CODEX_THREAD_ID??null,session:process.env.CODEX_SESSION_ID??null});
const reply=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
for await(const line of createInterface({input:process.stdin})) {
 const m=JSON.parse(line);record({event:m.method,params:m.params});
 if(m.method==='initialize') reply(m.id,{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'cbw-identity-probe',version:'0.1.0'}});
 else if(m.method==='tools/list')reply(m.id,{tools:[{name:'identity_probe',annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},description:'Record trusted call metadata for the local integration test; call once with no arguments.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]});
 else if(m.method==='tools/call')reply(m.id,{content:[{type:'text',text:'Identity probe recorded.'}]});
 else if(m.id!==undefined)reply(m.id,{});
}
