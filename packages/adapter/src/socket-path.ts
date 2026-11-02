import {connect} from 'node:net';
import {lstat,unlink} from 'node:fs/promises';
/** Remove only a dead Unix socket owned by this user; never replace a live broker or regular file. */
export async function prepareSocket(path:string){
  let info;try{info=await lstat(path);}catch(e:any){if(e.code==='ENOENT')return;throw e;}
  if(!info.isSocket()||info.uid!==process.getuid?.())throw new Error('SOCKET_PATH_NOT_OWNED');
  const status=await new Promise<string>((resolve,reject)=>{
    const probe=connect(path);probe.setTimeout(2000,()=>{probe.destroy();reject(new Error('BROKER_PROBE_TIMEOUT'));});
    probe.on('connect',()=>{probe.destroy();resolve('active');});
    probe.on('error',(e:any)=>{if(e.code==='ECONNREFUSED')resolve('stale');else reject(e);});
  });
  if(status==='active')throw new Error('BROKER_ALREADY_RUNNING');
  await unlink(path);
}
