import {AsyncLocalStorage} from 'node:async_hooks';
export const UNKNOWN_EXECUTION_GUIDANCE='If a page operation reports UNKNOWN or PAGE_EXECUTION_UNKNOWN, wait about three minutes and call list_pages again. When the page is usable, retry reads if needed. Before retrying an operation that may have changed state, verify what actually happened.';
export interface Operation {id:string;signal:AbortSignal;deadline:number;thread?:string;dispatched?:boolean}
export const operations=new AsyncLocalStorage<Operation>();
export class OperationError extends Error {
  constructor(code:string,readonly details:Record<string,unknown>={}){super(code);}
}
export function checkpoint(){
  const op=operations.getStore();
  if(op?.signal.aborted||op&&Date.now()>=op.deadline)throw new OperationError(op.signal.aborted?'REQUEST_CANCELLED':'REQUEST_TIMEOUT',{
    requestId:op.id,outcome:op.dispatched?'UNKNOWN':'NOT_STARTED',nextAction:op.dispatched?'inspect_page_before_retry':'retry_when_ready',
  });
}
export function dispatched(){checkpoint();const op=operations.getStore();if(op)op.dispatched=true;}
export function bounded<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return promise;
  const op=operations.getStore();
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(new OperationError('REQUEST_CANCELLED',{requestId:op?.id,outcome:op?.dispatched?'UNKNOWN':'NOT_STARTED',nextAction:op?.dispatched?'inspect_page_before_retry':'retry_when_ready'}));
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
export function errorDetails(error:any){
  const code=/^[A-Z][A-Z0-9_]+$/.test(error?.message)?error.message:'WORKSPACE_OPERATION_FAILED';
  const recovery:Record<string,string>={PAGE_NOT_OWNED:'list_pages_then_open_page',WORKSPACE_RESTORE_REQUIRED:'acknowledge_with_reset_workspace',BRIDGE_DISCONNECTED:'wait_for_extension_connection',UPSTREAM_DISCONNECTED_OUTCOME_UNKNOWN:'inspect_page_before_retry',PAGE_EXECUTION_UNKNOWN:'wait_3_minutes_then_list_pages'};
  const op=operations.getStore();
  return {code,outcome:op?(op.dispatched?'UNKNOWN':'NOT_STARTED'):'UNKNOWN',...(recovery[code]?{nextAction:recovery[code]}:{}),...error?.details};
}
