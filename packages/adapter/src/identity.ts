import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,basename,dirname,resolve,win32} from 'node:path';
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
  get count(){return this.owners.size;}
}
const compact=(value:string|undefined|null)=>(value??'').replace(/\s+/gu,' ').trim();
function shorten(value:string,max:number){const chars=Array.from(value);return chars.length>max?chars.slice(0,max-1).join('')+'…':value;}
function directoryProject(cwd:string|undefined):string {
  if(!cwd)return '';
  if(win32.isAbsolute(cwd)&&!cwd.startsWith('/'))return win32.basename(cwd.replace(/[\\/]+$/u,''));
  for(let directory=resolve(cwd);;directory=dirname(directory)){
    const marker=join(directory,'.git');
    const stat=statSync(marker,{throwIfNoEntry:false});
    if(stat?.isDirectory())return basename(directory);
    if(stat?.isFile()){
      const gitdir=readFileSync(marker,'utf8').match(/^gitdir:\s*(.+?)\s*$/mu)?.[1];
      if(gitdir){
        const git=resolve(directory,gitdir),commonFile=join(git,'commondir');
        const common=existsSync(commonFile)?resolve(git,readFileSync(commonFile,'utf8').trim()):git;
        if(basename(common)==='.git')return basename(dirname(common));
      }
      return basename(directory);
    }
    if(directory===dirname(directory))break;
  }
  return basename(resolve(cwd));
}
const defaultDatabase=()=>join(process.env.CODEX_HOME??join(homedir(),'.codex'),'state_5.sqlite');
function displayLabel(thread:string,cwd:string|undefined,title='',project=''):string {
  title||=`Codex ${thread.slice(0,8)}`;project||=compact(directoryProject(cwd));
  const prefix=project?`[${shorten(project,32)}]`:'';
  if(project&&title.startsWith(`[${project}]`))title=title.slice(project.length+2);
  else if(prefix&&title.startsWith(prefix))title=title.slice(prefix.length);
  return shorten(prefix+title,80);
}
function subagentSource(source:string):boolean {
  if(source==='subagent')return true;
  if(!source.startsWith('{'))return false;
  let value:unknown;
  try{value=JSON.parse(source);}catch(cause){throw new Error('THREAD_DATABASE_SOURCE_INVALID',{cause});}
  return !!value&&typeof value==='object'&&Object.hasOwn(value,'subagent');
}

// A broker owns one lazily opened read-only connection. Every query fully
// materializes its result synchronously, so no read transaction spans browser I/O.
export class CodexThreads {
  private db:DatabaseSync|undefined;
  private roots=new Map<string,string>();
  private closed=false;
  private connectionOpens=0;
  private familyQueries=0;
  private titleQueries=0;
  constructor(readonly dbPath=defaultDatabase()){}
  get diagnostics(){return {connectionOpen:!!this.db,connectionOpens:this.connectionOpens,familyQueries:this.familyQueries,titleQueries:this.titleQueries,cachedRoots:this.roots.size,closed:this.closed};}
  private ensureOpen(){if(this.closed)throw new Error('THREAD_DATABASE_CLOSED');}
  private database():DatabaseSync {
    this.ensureOpen();
    if(!this.db){
      try{this.db=new DatabaseSync(this.dbPath,{readOnly:true});this.connectionOpens++;}
      catch(cause){throw new Error('THREAD_DATABASE_UNAVAILABLE',{cause});}
    }
    return this.db;
  }
  private read<T>(sql:string,values:string[],kind:'family'|'title'):T|undefined {
    const db=this.database();
    if(kind==='family')this.familyQueries++;else this.titleQueries++;
    try{return db.prepare(sql).get(...values) as T|undefined;}
    catch(cause){
      const code=(cause as {errcode?:number}).errcode;
      throw new Error(code===1?'THREAD_DATABASE_SCHEMA':'THREAD_DATABASE_READ_FAILED',{cause});
    }
  }
  resolveRoot(caller:string):string {
    this.ensureOpen();
    const path=new Set<string>();
    let current=caller;
    for(;;){
      const cached=this.roots.get(current);
      if(cached){for(const thread of path)this.roots.set(thread,cached);return cached;}
      if(path.has(current))throw new Error('THREAD_DATABASE_INVALID_FAMILY');
      path.add(current);
      const row=this.read<{source:string;parent_thread_id:string|null}>(
        'SELECT t.source, e.parent_thread_id FROM threads t LEFT JOIN thread_spawn_edges e ON e.child_thread_id=t.id WHERE t.id=?',[current],'family');
      // A thread can become visible before its spawn edge. Never turn that
      // transient state (or a failed query) into a permanently independent root.
      if(!row)throw new Error('THREAD_FAMILY_NOT_READY');
      if(row.parent_thread_id){current=row.parent_thread_id;continue;}
      if(subagentSource(row.source))throw new Error('THREAD_FAMILY_NOT_READY');
      for(const thread of path)this.roots.set(thread,current);
      return current;
    }
  }
  displayTitle(root:string,clientCwd?:string):string {
    const row=this.read<{name:string|null;title:string;cwd:string;project:string|null}>(
      'SELECT t.name, t.title, t.cwd, p.name AS project FROM threads t LEFT JOIN projects p ON p.id=t.project_id WHERE t.id=?',[root],'title');
    const cwd=row?.cwd||clientCwd,title=compact(row?.name)||compact(row?.title);
    let project=compact(row?.project);
    if(!project&&cwd){
      const registered=this.read<{name:string}>(
        "SELECT p.name FROM project_roots r JOIN projects p ON p.id=r.project_id WHERE ?=r.path OR substr(?,1,length(r.path)+1)=r.path||'/' ORDER BY length(r.path) DESC LIMIT 1",[cwd,cwd],'title');
      project=compact(registered?.name);
    }
    return displayLabel(root,cwd,title,project);
  }
  close(){if(this.closed)return;this.db?.close();this.db=undefined;this.closed=true;}
}

// Kept for standalone callers; the shared broker uses its CodexThreads instance.
export function threadTitle(thread:string,dbPath=defaultDatabase(),clientCwd?:string):string {
  if(!existsSync(dbPath))return displayLabel(thread,clientCwd);
  const threads=new CodexThreads(dbPath);
  try{return threads.displayTitle(thread,clientCwd);}finally{threads.close();}
}
