import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function threadIdentity(meta:unknown):string {
  if(!meta||typeof meta!=='object'||Array.isArray(meta))throw new Error('THREAD_IDENTITY_UNAVAILABLE');
  const m=meta as Record<string,unknown>;
  const thread=m.threadId;
  const turn=m['x-codex-turn-metadata'] as Record<string,unknown>|undefined;
  // Identity is the per-call contract, not the installed CLI release number.
  // codex_version is diagnostic metadata and must not gate routine upgrades.
  if(typeof thread!=='string'||!uuid.test(thread)||!turn||typeof turn!=='object'||Array.isArray(turn)||turn.thread_id!==thread)throw new Error('THREAD_IDENTITY_UNAVAILABLE');
  return thread;
}
export class Controllers {
  private owners=new Map<string,string>();
  private threads=new Map<string,string>();
  attach(connection:string,thread:string) {
    const owner=this.owners.get(thread);
    if(owner&&owner!==connection)throw new Error('THREAD_ALREADY_ATTACHED');
    const previous=this.threads.get(connection);
    if(previous&&previous!==thread)this.owners.delete(previous);
    this.threads.set(connection,thread);this.owners.set(thread,connection);
    return previous===thread?undefined:previous;
  }
  detach(connection:string) {
    const thread=this.threads.get(connection);
    if(thread){this.threads.delete(connection);this.owners.delete(thread);}
    return thread;
  }
  attached(thread:string){return this.owners.has(thread);}
}
export function threadTitle(thread:string,dbPath=join(process.env.CODEX_HOME??join(homedir(),'.codex'),'state_5.sqlite')):string {
  if(!existsSync(dbPath))return `Codex ${thread.slice(0,8)}`;
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try {
    const row=db.prepare('SELECT name, title FROM threads WHERE id = ?').get(thread) as {name:string|null;title:string}|undefined;
    return (row?.name||row?.title||`Codex ${thread.slice(0,8)}`).replace(/\s+/g,' ').slice(0,80);
  }finally{db.close();}
}
