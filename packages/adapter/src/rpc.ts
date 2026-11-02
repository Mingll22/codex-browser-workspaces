import {connect,type Socket} from 'node:net';
import {VERSION} from './version.js';
import {OperationError} from './operation.js';
export class Rpc {
  private socket:Socket;
  private next=0;
  private pending=new Map<number,{resolve:(x:any)=>void;reject:(e:Error)=>void}>();
  private heartbeat:NodeJS.Timeout;
  private reconnecting?:Promise<Rpc>;
  private closed=false;
  ready:Promise<void>;
  constructor(private path:string){
    this.socket=connect(path);let buffer='';
    this.ready=new Promise((resolve,reject)=>{this.socket.once('connect',resolve);this.socket.once('error',reject);});
    this.socket.on('error',()=>{});
    this.socket.on('data',chunk=>{
      buffer+=chunk;
      if(buffer.length>16*1024*1024){this.socket.destroy();return;}
      for(let index;(index=buffer.indexOf('\n'))>=0;){
        const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
        let msg;try{msg=JSON.parse(line);}catch{this.socket.destroy();return;}
        const p=this.pending.get(msg.id);if(!p)continue;
        if(msg.error)p.reject(new OperationError(msg.error,msg.details));else p.resolve(msg.result);
      }
    });
    this.socket.on('close',()=>{clearInterval(this.heartbeat);for(const p of this.pending.values())p.reject(new OperationError('BROKER_DISCONNECTED',{outcome:'UNKNOWN',nextAction:'inspect_page_before_retry'}));});
    this.heartbeat=setInterval(()=>{if(!this.socket.destroyed)this.socket.write('{"method":"ping"}\n');},20000);this.heartbeat.unref();
  }
  async call(method:string,params:unknown={},options:{signal?:AbortSignal;deadline?:number}={}):Promise<any>{
    if(this.closed)throw new Error('BROKER_DISCONNECTED');
    const deadline=options.deadline??Date.now()+60000;
    if(options.signal?.aborted||Date.now()>=deadline)throw new OperationError('REQUEST_CANCELLED',{outcome:'NOT_STARTED'});
    await this.ready;
    // Reconnect only for a new call. Never replay a request lost in flight.
    if(this.socket.destroyed){
      this.reconnecting??=(async()=>{
        const replacement=new Rpc(this.path);
        try{await replacement.ready;await replacement.call('hello',{cwd:process.cwd(),version:VERSION});return replacement;}
        catch(error){replacement.close();this.reconnecting=undefined;throw error;}
      })();
      return (await this.reconnecting).call(method,params,{...options,deadline});
    }
    const id=++this.next;
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);this.pending.delete(id);};
      const cancel=(code:string)=>{if(!this.socket.destroyed)this.socket.write(JSON.stringify({method:'cancel',params:{id}})+'\n');cleanup();reject(new OperationError(code,{outcome:'UNKNOWN',nextAction:'inspect_page_before_retry'}));};
      const abort=()=>cancel('REQUEST_CANCELLED');
      // Broker deadline normally responds first, including a precise outcome.
      const timer=setTimeout(()=>cancel('REQUEST_TIMEOUT'),Math.max(1,deadline-Date.now()+250));
      this.pending.set(id,{resolve:v=>{cleanup();resolve(v);},reject:e=>{cleanup();reject(e);}});
      options.signal?.addEventListener('abort',abort,{once:true});
      if(options.signal?.aborted){abort();return;}
      this.socket.write(JSON.stringify({id,method,params,deadline})+'\n');
    });
  }
  close(){this.closed=true;this.socket.destroy();void this.reconnecting?.then(client=>client.close(),()=>{});}
}
