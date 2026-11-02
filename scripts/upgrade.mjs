#!/usr/bin/env node
// Source-checkout upgrade: builds/tests local source and uses source-only helpers.
// Prebuilt archives support install/rollback, not this upgrade entry point.
// Keeps browser/profile/state; replaces only this adapter and extension.
import {readFile,writeFile,cp,rename,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import assert from 'node:assert/strict';
const args=process.argv.slice(2),option=(key,otherwise)=>{const i=args.indexOf(key);return i<0?otherwise:args[i+1];};
const adapterOnly=args.includes('--adapter-only');
const extensionPath=option('--extension-dir');
if(!extensionPath||extensionPath.startsWith('--'))throw Error('Source-checkout upgrade requires --extension-dir <Windows extension directory>; prebuilt archives support install/rollback only.');
const anchor=option('--anchor');if(!/^[A-F0-9]{32}$/.test(anchor??''))throw Error('Pass --anchor with an owned target from open_page/list_pages');
const extensionDir=resolve(extensionPath);
const destination=resolve(option('--destination',join(homedir(),'.local/share/codex-browser-workspaces')));
const stateDir=resolve(option('--state-dir',join(homedir(),'.local/state/codex-browser-workspaces')));
const source=fileURLToPath(new URL('../',import.meta.url));
const stamp=new Date().toISOString().replaceAll(/[:.]/g,'-');
const reportPath=resolve(option('--report',join(stateDir,`upgrade-${stamp}.json`)));
const report={startedAt:new Date().toISOString(),steps:[],source,destination,extensionDir};
const run=(command,argv,capture=false)=>new Promise((resolve,reject)=>{
 const child=spawn(command,argv,{cwd:source,stdio:capture?['ignore','pipe','inherit']:'inherit'});let output='';
 child.stdout?.on('data',chunk=>output+=chunk);child.on('error',reject);child.on('exit',code=>code===0?resolve(output):reject(Error(`${command} exited ${code}`)));
});
const step=name=>{report.steps.push(name);console.log(name);};
const systemctl=action=>run('systemctl',['--user',action,'codex-browser-workspaces.service']);
await run('npm',['run','build']);await run('npm',['test']);step('build_and_tests_passed');
const {Rpc}=await import('../dist/adapter/src/rpc.js');
const {extensionTestClient}=await import('./extension-test-client.mjs');
const config=JSON.parse(await readFile(join(stateDir,'config.json'),'utf8'));
const version=JSON.parse(await readFile(join(source,'package.json'),'utf8')).version;
const healthURL=config.pairing.url.replace('ws:','http:')+'/health';
const oldVersion=JSON.parse(await readFile(join(destination,'package.json'),'utf8')).version;
const rpc=new Rpc(config.socket);await rpc.ready;
let staged,activated=false,stopped=false,extensionCopied=false,reloaded=false;
const extensionBackup=extensionDir+'-backup-'+stamp;
async function snapshot(){
 const ext=await extensionTestClient(anchor);
 try{return await ext.evaluate(`async()=>{const {state}=await chrome.storage.session.get('state');if(!state)throw Error('WORKSPACE_STATE_UNAVAILABLE');const targets=await chrome.debugger.getTargets(),receipts=[];for(const ws of Object.values(state.workspaces))for(const key of Object.keys(ws.tabs)){const tab=await chrome.tabs.get(Number(key)),target=targets.find(t=>t.tabId===tab.id&&t.type==='page');if(!target||tab.groupId!==ws.groupId||tab.windowId!==ws.windowId)throw Error('WORKSPACE_UPGRADE_TARGET_CHANGED');receipts.push({tabId:tab.id,targetId:target.id,groupId:tab.groupId,windowId:tab.windowId});}return {generation:state.generation,version:chrome.runtime.getManifest().version,receipts};}`);}finally{await ext.close();}
}
async function waitHealth(expected){
 const deadline=Date.now()+30000;let last;
 while(Date.now()<deadline){try{last=await (await fetch(healthURL,{signal:AbortSignal.timeout(1500)})).json();if(last.connected&&(!last.adapter||last.adapter===expected)&&(!last.extension||last.extension===expected))return last;}catch(e){last={error:e.message};}await new Promise(r=>setTimeout(r,250));}
 throw Error('UPGRADE_HEALTH_TIMEOUT '+JSON.stringify(last));
}
try{
 report.before=await snapshot();
 if(adapterOnly&&report.before.version!==version)throw Error('ADAPTER_ONLY_REQUIRES_MATCHING_EXTENSION_VERSION');
 staged=JSON.parse(await run(process.execPath,['scripts/install.mjs','--stage-only','--destination',destination,'--state-dir',stateDir],true));report.previous=staged.previous;
 await cp(extensionDir,extensionBackup,{recursive:true});report.extensionBackup=extensionBackup;step('installation_and_extension_backed_up');
 if(oldVersion!=='0.1.1'){await rpc.call('maintenance',{enabled:true});step('broker_quiesced');}
 // The initial 0.1.1 migration has no maintenance protocol. Stop only the broker;
 // later versions refuse upgrades during active tool work instead of interrupting it.
 await systemctl('stop');stopped=true;
 if(!adapterOnly){await run(process.execPath,['scripts/stage-extension-upgrade.mjs',anchor]);step('live_target_receipts_staged');}
 report.before=await snapshot();
 if(staged.previous)await rename(destination,staged.previous);
 try{await rename(staged.staging,destination);activated=true;}catch(e){if(staged.previous)await rename(staged.previous,destination);throw e;}
 if(!adapterOnly){await cp(join(destination,'dist/extension'),extensionDir,{recursive:true});extensionCopied=true;}
 await run('systemctl',['--user','daemon-reload']);
 await systemctl('start');stopped=false;
 // Load the extension only after its listener is reachable. An extension reload
 // while the WSL port is down may leave Chrome's initial WebSocket connecting.
 const listenerDeadline=Date.now()+15000;
 while(true){try{const health=await (await fetch(healthURL,{signal:AbortSignal.timeout(1000)})).json();if(health.adapter===version)break;}catch{}if(Date.now()>listenerDeadline)throw Error('BROKER_LISTENER_NOT_READY');await new Promise(r=>setTimeout(r,100));}
 if(!adapterOnly){
  await run(process.execPath,['scripts/reload-own-extension.mjs',anchor]);reloaded=true;
  // Resolve the new MV3 worker through official MCP before waiting on its socket.
  // With the upstream's lazy worker attachment, the first worker inspection can
  // complete startup; health polling alone does not exercise that boundary.
  await snapshot();
 }
 report.health=await waitHealth(version);
 report.after=await snapshot();
 assert.equal(report.after.version,version);assert.equal(report.after.generation,report.before.generation);
 assert.deepEqual(report.after.receipts.sort((a,b)=>a.tabId-b.tabId),report.before.receipts.sort((a,b)=>a.tabId-b.tabId));
 assert.equal(JSON.parse(await readFile(join(destination,'package.json'),'utf8')).version,version);
 assert.equal(await readFile(join(extensionDir,'worker.js'),'utf8'),await readFile(join(source,'packages/extension/worker.js'),'utf8'));
 step('runtime_versions_and_exact_owned_targets_verified');report.success=true;
}catch(error){
 report.error=error.stack;report.success=false;console.error(error);
 try{const ext=await extensionTestClient(anchor);try{report.connectionFailure=await ext.evaluate('()=>globalThis.cbwConnectionStatus?.()??{diagnosticsUnavailable:true}');}finally{await ext.close();}}catch(e){report.connectionDiagnosticError=e.message;}
 if(activated||extensionCopied||stopped){
  try{
   await systemctl('stop');
   if(reloaded){await run(process.execPath,['scripts/stage-extension-upgrade.mjs',anchor]);}
   if(extensionCopied)await cp(extensionBackup,extensionDir,{recursive:true});
   if(activated&&staged.previous){report.failedInstallation=destination+'-failed-'+stamp;await rename(destination,report.failedInstallation);await rename(staged.previous,destination);}
   await run('systemctl',['--user','daemon-reload']);await systemctl('start');
   if(extensionCopied)await run(process.execPath,['scripts/reload-own-extension.mjs',anchor]);
   report.rollbackHealth=await waitHealth(oldVersion);report.rollback=await snapshot();step('rollback_verified');
  }catch(rollbackError){report.rollbackError=rollbackError.stack;console.error('Rollback requires attention:',rollbackError.message);}
 }
 process.exitCode=1;
}finally{
 rpc.close();report.finishedAt=new Date().toISOString();await mkdir(resolve(reportPath,'..'),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log('Upgrade report:',reportPath);
}
