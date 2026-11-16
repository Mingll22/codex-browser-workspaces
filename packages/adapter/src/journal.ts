import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
import {dirname} from 'node:path';
export interface Event {at:number;event:string;requestId?:string;thread?:string;tool?:string;code?:string;outcome?:string;durationMs?:number}
// A bounded diagnostic ledger. Arguments, URLs and page content never enter it.
export class Journal {
  private events:Event[]=[];
  private timer?:NodeJS.Timeout;
  private writes=Promise.resolve();
  constructor(private path:string,private limit=200){}
  async load(){try{this.events=JSON.parse(await readFile(this.path,'utf8')).slice(-this.limit);}catch(e:any){if(e.code!=='ENOENT')throw e;}}
  record(event:Omit<Event,'at'>){
    this.events.push({at:Date.now(),...event});this.events=this.events.slice(-this.limit);
    this.timer??=setTimeout(()=>{this.timer=undefined;void this.flush().catch(e=>console.error('Diagnostic write failed:',e.code??e.message));},500);this.timer.unref();
  }
  recent(thread:string){return this.events.filter(e=>e.thread===thread).slice(-12);}
  unknownRequest(requestId:string,thread:string,tool:string,lastUsed:number){
    const rows=this.events.filter(e=>e.requestId===requestId);
    const started=rows.find(e=>e.event==='request_started'&&e.thread===thread&&e.tool===tool);
    const failed=rows.find(e=>e.event==='request_failed'&&e.thread===thread&&e.tool===tool&&e.outcome==='UNKNOWN');
    if(!started||!failed||lastUsed<started.at||lastUsed>failed.at||rows.some(e=>e.event==='execution_reconciled'))throw new Error('EXECUTION_RECONCILE_REQUEST_MISMATCH');
    return {startedAt:started.at,failedAt:failed.at,code:failed.code};
  }
  flush(){
    if(this.timer){clearTimeout(this.timer);this.timer=undefined;}
    const data=JSON.stringify(this.events);
    const write=this.writes.then(async()=>{await mkdir(dirname(this.path),{recursive:true,mode:0o700});await writeFile(this.path+'.tmp',data,{mode:0o600});await rename(this.path+'.tmp',this.path);});
    this.writes=write.catch(()=>{});return write;
  }
}
