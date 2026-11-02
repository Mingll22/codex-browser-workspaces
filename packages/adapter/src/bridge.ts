import {checkpoint,operations,dispatched,OperationError} from './operation.js';
import {VERSION} from './version.js';
import {createServer, type Server} from 'node:http';
import {randomUUID, timingSafeEqual} from 'node:crypto';
import {WebSocketServer, WebSocket} from 'ws';
export interface Pairing {url:string;token:string;extensionId:string}
export interface Page {tabId:number;targetId:string;groupId:number;url:string;slot:string;retained:boolean}
export class Bridge {
  server:Server;
  private wss:WebSocketServer;
  private socket?:WebSocket;
  generation?:string;
  extensionVersion?:string;
  onPopup?:(event:{tabId:number;targetId:string;initialGroupId:number;generation:string})=>Promise<void>;
  private lastPong=Date.now();
  private pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
  private heartbeat:NodeJS.Timeout;
  constructor(private pairing:Pairing) {
    const endpoint=new URL(pairing.url);
    if(endpoint.hostname!=='127.0.0.1'||endpoint.protocol!=='ws:')throw new Error('BRIDGE_LOOPBACK_REQUIRED');
    this.server=createServer((req,res)=>{
      if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({service:'codex-browser-workspaces',connected:!!this.socket,adapter:VERSION,extension:this.extensionVersion,upstream:'1.11.0'}));}
      else {res.writeHead(404);res.end();}
    });
    this.wss=new WebSocketServer({noServer:true,maxPayload:1024*1024});
    this.server.on('upgrade',(req,socket,head)=>{
      if(req.url!=='/'||req.headers.origin!==`chrome-extension://${pairing.extensionId}`){socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;}
      this.wss.handleUpgrade(req,socket,head,ws=>this.accept(ws));
    });
    this.heartbeat=setInterval(()=>{if(this.socket&&Date.now()-this.lastPong>45000)this.socket.terminate();else this.socket?.send(JSON.stringify({type:'ping'}));},20000);
    this.heartbeat.unref();
  }
  private accept(ws:WebSocket) {
    let authenticated=false;
    const timeout=setTimeout(()=>ws.close(1008,'PAIRING_REQUIRED'),5000);
    ws.on('message',raw=>{
      let m:any;
      try{m=JSON.parse(raw.toString());}catch {ws.close(1008,'INVALID_MESSAGE');return;}
      if(!authenticated){
        const supplied=Buffer.from(typeof m.token==='string'?m.token:'');
        const expected=Buffer.from(this.pairing.token);
        if(m.type!=='hello'||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)||typeof m.generation!=='string') {ws.close(1008,'PAIRING_REJECTED');return;}
        if(this.socket){ws.close(1008,'BRIDGE_ALREADY_CONNECTED');return;}
        clearTimeout(timeout);authenticated=true;this.socket=ws;this.generation=m.generation;this.extensionVersion=m.version;this.lastPong=Date.now();
        return;
      }
      if(m.type==='pong'){this.lastPong=Date.now();return;}
      if(m.type==='popup'&&Number.isInteger(m.tabId)&&typeof m.targetId==='string'&&Number.isInteger(m.initialGroupId)&&m.generation===this.generation){
        void this.onPopup?.(m).catch(e=>console.error('Popup identity:',e.message));return;
      }
      if(m.type!=='response'||typeof m.id!=='string'){ws.close(1008,'INVALID_RESPONSE');return;}
      const p=this.pending.get(m.id);if(!p)return;
      this.pending.delete(m.id);clearTimeout(p.timer);
      if(m.error)p.reject(new OperationError(String(m.error),m.details));else p.resolve(m.result);
    });
    ws.on('error',()=>ws.close());
    ws.on('close',()=>{
      clearTimeout(timeout);
      if(this.socket!==ws)return;
      this.socket=undefined;
      for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('BRIDGE_DISCONNECTED'));}
      this.pending.clear();
    });
  }
  async listen() {
    const port=Number(new URL(this.pairing.url).port);
    await new Promise<void>((resolve,reject)=>{this.server.once('error',reject);this.server.listen(port,'127.0.0.1',()=>{this.server.off('error',reject);resolve();});});
  }
  request<T=any>(method:string,args:Record<string,unknown>={}):Promise<T> {
    checkpoint();
    if(!this.socket||this.socket.readyState!==WebSocket.OPEN)return Promise.reject(new Error('BRIDGE_DISCONNECTED'));
    const id=randomUUID(),socket=this.socket,op=operations.getStore();
    const deadline=Math.min(Date.now()+15000,op?.deadline??Infinity);
    if(['open','close','retain','title','adopt_popup','finalize_open','prepare_capture','finish_capture'].includes(method))dispatched();
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);op?.signal.removeEventListener('abort',abort);this.pending.delete(id);};
      const cancel=(code:string)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'cancel',id}));cleanup();reject(new OperationError(code,{outcome:op?.dispatched?'UNKNOWN':'NOT_STARTED',nextAction:'inspect_page_before_retry'}));};
      const abort=()=>cancel('REQUEST_CANCELLED');
      const timer=setTimeout(()=>cancel('BRIDGE_TIMEOUT_OUTCOME_UNKNOWN'),Math.max(1,deadline-Date.now()));
      this.pending.set(id,{resolve:v=>{cleanup();resolve(v);},reject:e=>{cleanup();reject(e);},timer});
      op?.signal.addEventListener('abort',abort,{once:true});
      if(op?.signal.aborted){abort();return;}
      socket.send(JSON.stringify({type:'request',id,method,args,deadline}));
    });
  }

  async close(){clearInterval(this.heartbeat);this.socket?.terminate();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('BRIDGE_DISCONNECTED'));}this.pending.clear();this.wss.close();await new Promise<void>(resolve=>this.server.close(()=>resolve()));}
}
