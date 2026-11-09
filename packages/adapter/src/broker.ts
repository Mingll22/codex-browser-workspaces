import {operations,checkpoint,bounded,errorDetails} from './operation.js';
import {Journal} from './journal.js';
import {VERSION} from './version.js';
import {createServer,type Socket} from 'node:net';
import {mkdir,chmod,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Ajv2020 as Ajv} from 'ajv/dist/2020.js';
import {Bridge} from './bridge.js';
import {openerTarget} from './target-identity.js';
import {Upstream} from './upstream.js';
import {Workspaces} from './workspaces.js';
import {threadIdentity} from './identity.js';
import {controllerProcess,type ControllerProcess} from './controller-process.js';
import {loadConfig} from './config.js';
import {prepareSocket} from './socket-path.js';
import type {Tool} from '@modelcontextprotocol/sdk/types.js';
const config=await loadConfig(process.argv[2]);
await mkdir(config.stateDir,{recursive:true,mode:0o700});
await mkdir(dirname(config.socket),{recursive:true,mode:0o700});
await prepareSocket(config.socket);
const bridge=new Bridge(config.pairing);
bridge.onPopup=async event=>{
  const openerTargetId=await openerTarget(config.browserURL,event.targetId);
  await bridge.request('adopt_popup',{...event,openerTargetId});
};
const upstream=new Upstream(config.browserURL);
await upstream.addRoot(process.cwd());
const ownTools:Tool[]=[
 {name:'open_page',description:'Open or reuse a named slot in this thread workspace. Same URL does not reload. Default slot: main.',inputSchema:{type:'object',properties:{url:{type:'string',pattern:'^(https?://|about:blank$)'},slot:{type:'string',minLength:1,maxLength:80}},required:['url'],additionalProperties:false}},
 {name:'list_pages',description:'List only pages owned by this real Codex thread.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'close_page',description:'Close an owned page, including the last page of this group.',inputSchema:{type:'object',properties:{pageId:{type:'string'}},required:['pageId'],additionalProperties:false}},
 {name:'set_page_retention',description:'Exclude/include an owned page from automatic workspace cleanup.',inputSchema:{type:'object',properties:{pageId:{type:'string'},retained:{type:'boolean'}},required:['pageId','retained'],additionalProperties:false}},
 {name:'reset_workspace',description:'After WORKSPACE_RESTORE_REQUIRED, acknowledge that the old browser session cannot be recovered. Never adopts or closes old tabs.',inputSchema:{type:'object',properties:{acknowledgeLostPages:{const:true}},required:['acknowledgeLostPages'],additionalProperties:false}},
];
const workspace=new Workspaces(bridge,upstream,join(config.stateDir,'workspaces.json'),config.maxTabs,config.detachedTtlMs,undefined,config.closedThreadGraceMs);
await workspace.load();
const journal=new Journal(join(config.stateDir,'events.json'));await journal.load();journal.record({event:'broker_started'});
const tools=[...ownTools,...await upstream.tools()];
const ajv=new Ajv({strict:false,allErrors:false});
const validators=new Map(tools.map(t=>[t.name,ajv.compile(t.inputSchema)]));
const sockets=new Set<Socket>();
let stopping=false;
let maintenanceOwner:Socket|undefined;
let activeCalls=0;
let collecting=false;
const server=createServer(socket=>{
  sockets.add(socket);const connection=randomUUID();let buffer='';let queue=Promise.resolve();let clientVersion='legacy';const requests=new Map<unknown,AbortController>();
  let clientProcess:ControllerProcess|undefined;
  let clientCwd:string|undefined;
  socket.setTimeout(65000,()=>socket.destroy());
  socket.on('error',()=>{});
  socket.on('close',()=>{if(maintenanceOwner===socket)maintenanceOwner=undefined;for(const controller of requests.values())controller.abort();sockets.delete(socket);void workspace.detach(connection).catch(error=>console.error('Detach failed:',error.message));});
  socket.on('data',chunk=>{
    buffer+=chunk;
    if(buffer.length>1024*1024){socket.destroy();return;}
    for(let newline;(newline=buffer.indexOf('\n'))>=0;){
      const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
      let message:any;try{message=JSON.parse(line);}catch{socket.destroy();return;}
      if(message.method==='ping')continue;
      if(message.method==='cancel'){requests.get(message.params?.id)?.abort();continue;}
      if(requests.has(message.id)){socket.destroy();return;}
      const controller=new AbortController();requests.set(message.id,controller);
      const received=Date.now(),deadline=Math.min(received+60000,Number.isFinite(message.deadline)?message.deadline:Infinity);
      const timer=setTimeout(()=>controller.abort(),Math.max(1,deadline-received));
      const op={id:randomUUID(),signal:controller.signal,deadline,thread:undefined as string|undefined,dispatched:false};
      if(message.method==='call'){
        try{op.thread=threadIdentity(message.params?.meta);}catch{} // Diagnostic identity only; validated again at dispatch.
        if(op.thread)journal.record({event:'request_queued',requestId:op.id,thread:op.thread,tool:validators.has(message.params?.name)?message.params.name:undefined});
      }
      queue=queue.then(()=>operations.run(op,async()=>{
        if(socket.destroyed){clearTimeout(timer);requests.delete(message.id);return;}
        const {id,method,params}=message;
        try{
          checkpoint();let result;
          if(method==='tools')result=tools;
          else if(method==='call'){
            if(maintenanceOwner)throw new Error('UPGRADE_IN_PROGRESS');
            const identity=threadIdentity(params.meta);op.thread=identity;
            const validate=validators.get(params.name);
            if(!validate)throw new Error('TOOL_NOT_ALLOWED');
            if(!validate(params.args))throw new Error('INVALID_TOOL_ARGUMENTS');
            journal.record({event:'request_started',requestId:op.id,thread:identity,tool:params.name});
            activeCalls++;
            const work=workspace.call(connection,identity,params.name,params.args,clientProcess,clientCwd).finally(()=>activeCalls--);
            result=await bounded(work,controller.signal);
            if(params.name==='list_pages'){
              const item=result.content[0];
              if(item.type==='text'){const value=JSON.parse(item.text);value.diagnostics=journal.recent(identity);value.runtime.client=clientVersion;value.runtime.reconnectRecommended=value.runtime.cleanup.enabled&&!value.runtime.cleanup.controllerRegistered;item.text=JSON.stringify(value);}
            }
            journal.record({event:'request_finished',requestId:op.id,thread:identity,tool:params.name,durationMs:Date.now()-received});
          }else if(method==='hello'){
            if(typeof params.cwd!=='string'||!params.cwd.startsWith('/'))throw new Error('INVALID_CLIENT_ROOT');
            const owner=params.pid===undefined?undefined:controllerProcess(params.pid);
            await upstream.addRoot(params.cwd);clientProcess=owner;clientCwd=params.cwd;clientVersion=typeof params.version==='string'?params.version:'legacy';result={version:VERSION};
          }else if(method==='maintenance'){
            if(params.enabled===false){if(maintenanceOwner!==socket)throw new Error('MAINTENANCE_NOT_OWNED');maintenanceOwner=undefined;}
            else {if(activeCalls||collecting||maintenanceOwner&&maintenanceOwner!==socket)throw new Error('UPGRADE_BUSY');maintenanceOwner=socket;}
            result={maintenance:!!maintenanceOwner,activeCalls};
          }else throw new Error('INVALID_BROKER_METHOD');
          if(!socket.destroyed)socket.write(JSON.stringify({id,result})+'\n');
        }catch(error:any){
          const details=errorDetails(error);
          if(controller.signal.aborted&&Date.now()>=deadline)details.code='REQUEST_TIMEOUT';
          journal.record({event:'request_failed',requestId:op.id,thread:op.thread,tool:validators.has(params?.name)?params.name:undefined,code:details.code,outcome:String(details.outcome??'UNKNOWN'),durationMs:Date.now()-received});
          if(!socket.destroyed)socket.write(JSON.stringify({id,error:details.code,details})+'\n');
        }finally{clearTimeout(timer);requests.delete(id);}
      }));
    }
  });
});
try{
  await bridge.listen();
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(config.socket,()=>{server.off('error',reject);resolve();});});
  await chmod(config.socket,0o600);
}catch(error){await upstream.close();await bridge.close();throw error;}
const gc=setInterval(()=>{
  if(collecting||maintenanceOwner)return;collecting=true;
  void workspace.collect().catch(error=>console.error('Collection failed:',error.message)).finally(()=>{collecting=false;});
},Math.min(config.detachedTtlMs??60000,config.closedThreadGraceMs===null?60000:5000));gc.unref();
console.log('Codex Browser Workspaces broker ready:',config.socket);
async function stop(){
  if(stopping)return;stopping=true;clearInterval(gc);
  for(const socket of sockets)socket.destroy();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  await upstream.close();await bridge.close();journal.record({event:'broker_stopped'});await journal.flush();
  try{await unlink(config.socket);}catch(error:any){if(error.code!=='ENOENT')throw error;}
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void stop().then(()=>process.exit()));
