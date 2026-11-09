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
export function threadTitle(thread:string,dbPath=join(process.env.CODEX_HOME??join(homedir(),'.codex'),'state_5.sqlite'),clientCwd?:string):string {
  let cwd=clientCwd,title='',project='';
  if(existsSync(dbPath)){
    const db=new DatabaseSync(dbPath,{readOnly:true});
    try {
      const row=db.prepare('SELECT t.name, t.title, t.cwd, p.name AS project FROM threads t LEFT JOIN projects p ON p.id=t.project_id WHERE t.id=?').get(thread) as {name:string|null;title:string;cwd:string;project:string|null}|undefined;
      cwd=row?.cwd||clientCwd;title=compact(row?.name)||compact(row?.title);project=compact(row?.project);
      if(!project&&cwd){
        const root=db.prepare("SELECT p.name FROM project_roots r JOIN projects p ON p.id=r.project_id WHERE ?=r.path OR substr(?,1,length(r.path)+1)=r.path||'/' ORDER BY length(r.path) DESC LIMIT 1").get(cwd,cwd) as {name:string}|undefined;
        project=compact(root?.name);
      }
    }finally{db.close();}
  }
  title||=`Codex ${thread.slice(0,8)}`;project||=compact(directoryProject(cwd));
  const prefix=project?`[${shorten(project,32)}]`:'';
  if(project&&title.startsWith(`[${project}]`))title=title.slice(project.length+2);
  else if(prefix&&title.startsWith(prefix))title=title.slice(prefix.length);
  return shorten(prefix+title,80);
}
