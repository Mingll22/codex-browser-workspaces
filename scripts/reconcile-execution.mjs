#!/usr/bin/env node
// Explicit local admin maintenance. Browser calls stay on the existing official
// MCP client so its original per-page mutex remains authoritative.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createConnection} from 'node:net';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import WebSocket from 'ws';
import {Rpc} from '../dist/adapter/src/rpc.js';
import {controllerProcess} from '../dist/adapter/src/controller-process.js';

export class Inspector {
  constructor(ws){
    this.ws=ws;this.next=0;this.pending=new Map();
    ws.on('message',raw=>{const message=JSON.parse(raw);const request=this.pending.get(message.id);if(!request)return;this.pending.delete(message.id);clearTimeout(request.timer);if(message.error)request.reject(Error(request.method+': '+message.error.message));else request.resolve(message.result);});
    ws.on('close',()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('BROKER_INSPECTOR_DISCONNECTED'));}this.pending.clear();});
  }
  static async connect(url){const ws=new WebSocket(url);await new Promise((done,fail)=>{ws.once('open',done);ws.once('error',fail);});const inspector=new Inspector(ws);await inspector.call('Runtime.enable');return inspector;}
  call(method,params={},timeoutMs=30000){return new Promise((resolve,reject)=>{const id=++this.next;const timer=timeoutMs?setTimeout(()=>{this.pending.delete(id);reject(Error('BROKER_INSPECTOR_TIMEOUT'));},timeoutMs):undefined;this.pending.set(id,{resolve,reject,timer,method});this.ws.send(JSON.stringify({id,method,params}));});}
  async evaluate(expression){
    // Keep async imports rooted until V8 has delivered the inspector response.
    const slot='__cbwAdminInspection';
    const source=`globalThis[${JSON.stringify(slot)}]=(${expression})`;
    const loader=`process.getBuiltinModule('vm').runInThisContext(${JSON.stringify(source)},{importModuleDynamically:process.getBuiltinModule('vm').constants.USE_MAIN_CONTEXT_DEFAULT_LOADER})`;
    try{const r=await this.call('Runtime.evaluate',{expression:loader,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result;}
    finally{await this.call('Runtime.evaluate',{expression:`delete globalThis[${JSON.stringify(slot)}]`});}
  }
  async instance(moduleURL,name){
    const prototype=await this.evaluate(`import(${JSON.stringify(moduleURL)}).then(m=>m[${JSON.stringify(name)}].prototype)`);
    const found=await this.call('Runtime.queryObjects',{prototypeObjectId:prototype.objectId});
    const properties=await this.call('Runtime.getProperties',{objectId:found.objects.objectId,ownProperties:true});
    const objects=properties.result.filter(p=>/^\d+$/.test(p.name));
    if(objects.length!==1)throw Error('BROKER_INSTANCE_NOT_UNIQUE: '+name);return objects[0].value.objectId;
  }
  close(){this.ws.close();}
}

async function portBusy(){return new Promise(done=>{const socket=createConnection({host:'127.0.0.1',port:9229});socket.once('connect',()=>{socket.destroy();done(true);});socket.once('error',()=>done(false));});}
async function main(){
  const args=process.argv.slice(2),option=key=>args[args.indexOf(key)+1];
  if(!args.includes('--pid')||!args.includes('--plan')||!args.includes('--output'))throw Error('Use --pid BROKER_PID --plan exact-recovery.json --output result.json [--installation DIR]');
  const pid=Number(option('--pid')),installation=resolve(args.includes('--installation')?option('--installation'):join(homedir(),'.local/share/codex-browser-workspaces'));
  const cmd=(await readFile(`/proc/${pid}/cmdline`,'utf8')).split('\0');
  if(!cmd.includes(join(installation,'dist/adapter/src/broker.js'))||(await stat(`/proc/${pid}`)).uid!==process.getuid())throw Error('BROKER_PROCESS_MISMATCH');
  const owner=controllerProcess(pid);if(!owner)throw Error('BROKER_PROCESS_MISSING');
  const configPath=cmd[cmd.indexOf(join(installation,'dist/adapter/src/broker.js'))+1];
  const config=JSON.parse(await readFile(configPath,'utf8'));
  const plan=JSON.parse(await readFile(resolve(option('--plan')),'utf8'));
  const output=resolve(option('--output')),report={startedAt:new Date().toISOString(),broker:owner,plan};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  const rpc=new Rpc(config.socket);let inspector,enabled=false,maintenance=false;
  try{
    await rpc.ready;await rpc.call('maintenance',{enabled:true});maintenance=true;
    if(await portBusy())throw Error('BROKER_INSPECTOR_PORT_BUSY');
    process.kill(pid,'SIGUSR1');enabled=true;
    let endpoints;
    for(let attempt=0;attempt<30;attempt++){
      try{endpoints=await (await fetch('http://127.0.0.1:9229/json/list',{signal:AbortSignal.timeout(1000)})).json();if(endpoints.length===1)break;}catch{}
      await new Promise(done=>setTimeout(done,100));
    }
    if(endpoints?.length!==1)throw Error('BROKER_INSPECTOR_UNAVAILABLE');
    inspector=await Inspector.connect(endpoints[0].webSocketDebuggerUrl);
    const identity=await inspector.evaluate('({pid:process.pid})');
    const properties=await inspector.call('Runtime.getProperties',{objectId:identity.objectId,ownProperties:true});
    if(properties.result.find(p=>p.name==='pid')?.value?.value!==pid||controllerProcess(pid)?.startTime!==owner.startTime)throw Error('BROKER_PROCESS_CHANGED');
    const base=pathToFileURL(installation+'/').href;
    const workspace=await inspector.instance(base+'dist/adapter/src/workspaces.js','Workspaces');
    const journal=await inspector.instance(base+'dist/adapter/src/journal.js','Journal');
    const candidate=pathToFileURL(resolve(fileURLToPath(new URL('../dist/adapter/src/',import.meta.url)))+'/').href;
    // Only add the reviewed maintenance methods. Existing queues, transports,
    // leases and controllers stay intact; no caller identity is fabricated.
    const recoverySource=`async (workspace,journal,base,plan)=>{
      const revision='?maintenance='+Date.now();
      const [{Workspaces},{Upstream},{PageLeases},{Journal}]=await Promise.all(['workspaces','upstream','leases','journal'].map(name=>import(base+name+'.js'+revision)));
      workspace.upstream.drainExecution=Upstream.prototype.drainExecution;
      workspace.leases.reconcile=PageLeases.prototype.reconcile;
      journal.unknownRequest=Journal.prototype.unknownRequest;
      return Workspaces.prototype.reconcileExecution.call(workspace,plan,journal);
    }`;
    const result=await inspector.call('Runtime.callFunctionOn',{objectId:workspace,arguments:[{objectId:journal},{value:candidate},{value:plan}],awaitPromise:true,returnByValue:true,functionDeclaration:`function(journal,base,plan){
      const run=process.getBuiltinModule('vm').runInThisContext(${JSON.stringify(recoverySource)},{importModuleDynamically:process.getBuiltinModule('vm').constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
      return globalThis.__cbwAdminRecovery=run(this,journal,base,plan).finally(()=>{delete globalThis.__cbwAdminRecovery;});
    }`},0);
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
    report.result=result.result.value;report.success=true;
  }catch(error){report.success=false;report.error=error.message;process.exitCode=1;}
  finally{
    if(inspector){
      try{await inspector.evaluate("(setTimeout(()=>import('node:inspector').then(m=>m.close()),100),true)");}catch(error){report.inspectorCleanupError=error.message;}
      inspector.close();
    }
    if(enabled){await new Promise(done=>setTimeout(done,250));report.inspectorClosed=!(await portBusy());if(!report.inspectorClosed){report.success=false;process.exitCode=1;}}
    if(maintenance){try{await rpc.call('maintenance',{enabled:false});report.maintenanceReleased=true;}catch(error){report.maintenanceReleaseError=error.message;report.success=false;process.exitCode=1;}}
    rpc.close();report.finishedAt=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  }
  console.log(JSON.stringify({success:report.success,output,execution:report.result?.execution,closed:report.result?.closed,inspectorClosed:report.inspectorClosed}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
