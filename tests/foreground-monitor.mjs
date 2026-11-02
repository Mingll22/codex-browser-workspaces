import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
const execute=promisify(execFile);
export async function monitorForeground(){
 const stop=resolve(`.artifacts/foreground-stop-${process.pid}-${Date.now()}`);
 const windowsPath=async path=>(await execute('wslpath',['-w',path])).stdout.trim();
 const child=spawn('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',await windowsPath(resolve('scripts/watch-foreground.ps1')),'-StopPath',await windowsPath(stop)]);
 let out='',err='';let readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject});
 child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('READY'))readyResolve();});child.stderr.on('data',chunk=>err+=chunk);
 const finished=new Promise((resolve,reject)=>{child.on('error',error=>{readyReject(error);reject(error)});child.on('close',code=>{if(code!==0){const e=new Error('FOREGROUND_MONITOR_FAILED '+err);readyReject(e);reject(e);}else resolve();});});
 // Attach immediately so a startup failure is not an unhandled rejection.
 finished.catch(()=>{});await ready;
 return async()=>{await writeFile(stop,'stop');await finished;await unlink(stop);return JSON.parse(out.trim().split(/\r?\n/).at(-1));};
}
