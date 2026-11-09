import {LeaseStatus} from '../../protocol/src/contracts.js';
import {OperationError} from './operation.js';

export const LEASE_MS=5*60_000;
export type Lease={version:number;owner:string;lastUsed:number;expiresAt:number;executing:number;unknown:boolean;membership?:string};
export class PageLeases {
  private rows=new Map<string,Lease>();
  private memberships=new Map<string,string>();
  constructor(private now=()=>Date.now()){}
  load(rows:Record<string,Lease>={}){for(const [key,row] of Object.entries(rows))this.rows.set(key,{...row,unknown:row.unknown||row.executing>0,executing:0});}
  snapshot(){return Object.fromEntries(this.rows);}
  bind(key:string,membership:string){
    const row=this.rows.get(key),previous=row?.membership??this.memberships.get(key);
    if(previous&&previous!==membership)this.invalidate(key);
    this.memberships.set(key,membership);if(row)row.membership=membership;
  }
  private available(row:Lease){return !row.unknown&&!row.executing&&this.now()>=row.expiresAt;}
  view(key:string,caller:string){
    const row=this.rows.get(key);
    if(!row)return {visible:true,version:1,status:LeaseStatus.AVAILABLE};
    if(this.available(row))return {visible:true,version:row.version+1,status:LeaseStatus.AVAILABLE};
    return {visible:row.owner===caller,version:row.version,status:row.unknown?LeaseStatus.UNKNOWN:LeaseStatus.OWNED,expiresAt:row.expiresAt};
  }
  begin(key:string,caller:string,version:number){
    const old=this.rows.get(key),view=this.view(key,caller);
    if(old?.executing&&old.expiresAt===0)throw new OperationError('PAGE_OPERATION_IN_PROGRESS',{outcome:'NOT_STARTED'});
    if(old?.unknown)throw new OperationError('PAGE_EXECUTION_UNKNOWN',{outcome:'UNKNOWN',nextAction:'reconcile_execution_before_releasing'});
    if(!view.visible)throw new OperationError('PAGE_LEASE_BUSY',{outcome:'NOT_STARTED',nextAction:'list_pages'});
    if(view.version!==version)throw new OperationError('PAGE_LEASE_EXPIRED',{outcome:'NOT_STARTED',nextAction:'list_pages_then_read_fresh_state'});
    const now=this.now();
    const row=old&&old.version===version?old:{version,owner:caller,lastUsed:now,expiresAt:now+LEASE_MS,executing:0,unknown:false,membership:this.memberships.get(key)};
    row.owner=caller;row.lastUsed=now;row.expiresAt=now+LEASE_MS;row.executing++;this.rows.set(key,row);
    return {key,version,owner:caller,newGrant:!old||old.version!==version};
  }
  validate(token:{key:string;version:number;owner:string}){
    const row=this.rows.get(token.key);
    if(!row||row.version!==token.version||row.owner!==token.owner)throw new OperationError('PAGE_REFERENCE_EXPIRED',{outcome:'UNKNOWN',nextAction:'list_pages_then_read_fresh_state'});
  }
  finish(token:{key:string;version:number;owner:string},unknown=false){
    const row=this.rows.get(token.key);if(!row||row.version!==token.version||row.owner!==token.owner)return;
    row.executing=Math.max(0,row.executing-1);row.unknown||=unknown;
  }
  release(key:string,caller:string,version:number){
    const row=this.rows.get(key);if(!row)return;
    if(row.owner!==caller)throw new Error('PAGE_LEASE_BUSY');
    if(row.version!==version)throw new Error('PAGE_LEASE_EXPIRED');
    if(row.executing||row.unknown)throw new Error(row.unknown?'PAGE_EXECUTION_UNKNOWN':'PAGE_OPERATION_IN_PROGRESS');
    row.expiresAt=0;
  }
  invalidate(key:string){const row=this.rows.get(key);if(row)row.expiresAt=0;}
  held(key:string){const row=this.rows.get(key);return !!row&&!this.available(row);}
}
