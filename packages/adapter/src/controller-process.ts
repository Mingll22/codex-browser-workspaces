import {readFileSync} from 'node:fs';

// A controller process is lifetime evidence only. Tool metadata still supplies
// the thread identity, and the extension still verifies every page's ownership.
export interface ControllerProcess {pid:number;startTime:string}
export function controllerProcess(pid:unknown):ControllerProcess|undefined {
  if(!Number.isSafeInteger(pid)||Number(pid)<=1)throw new Error('INVALID_CONTROLLER_PID');
  let stat:string;
  try{stat=readFileSync(`/proc/${pid}/stat`,'utf8');}
  catch(error:any){if(error.code==='ENOENT'||error.code==='ESRCH')return;throw error;}
  const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');
  if(fields[0]==='Z'||fields[0]==='X')return;
  if(!/^\d+$/.test(fields[19]??''))throw new Error('CONTROLLER_STATE_UNAVAILABLE');
  return {pid:Number(pid),startTime:fields[19]};
}
export function controllerExited(owner:ControllerProcess):boolean {
  const current=controllerProcess(owner.pid);
  return !current||current.startTime!==owner.startTime;
}
