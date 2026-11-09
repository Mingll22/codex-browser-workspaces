import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CodexThreads} from '../dist/adapter/src/identity.js';

const schema=`
 CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE project_roots(project_id TEXT,path TEXT);
 CREATE TABLE threads(id TEXT PRIMARY KEY,source TEXT NOT NULL,name TEXT,title TEXT,cwd TEXT,project_id TEXT);
 CREATE TABLE thread_spawn_edges(parent_thread_id TEXT NOT NULL,child_thread_id TEXT PRIMARY KEY,status TEXT NOT NULL);
`;
const spawned=parent=>JSON.stringify({subagent:{thread_spawn:{parent_thread_id:parent,depth:1}}});
async function fixture(t,{create=true}={}){
 const directory=await mkdtemp(join(tmpdir(),'cbw-family-')),path=join(directory,'state.sqlite');
 const db=create?new DatabaseSync(path):undefined,threads=new CodexThreads(path);
 db?.exec(schema);
 t.after(async()=>{threads.close();db?.close();await rm(directory,{recursive:true,force:true});});
 const thread=(id,source='cli',name=id)=>db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?)').run(id,source,name,'old title','/workspace/default',null);
 const edge=(parent,child,status='completed')=>db.prepare('INSERT INTO thread_spawn_edges VALUES (?,?,?)').run(parent,child,status);
 return {directory,path,db,threads,thread,edge};
}

test('deep historical chains and siblings share a cached root independently of edge status',async t=>{
 const {threads,thread,edge}=await fixture(t);thread('root');
 let parent='root';
 for(let n=0;n<128;n++){
  const child=`child-${n}`;thread(child,spawned(parent));edge(parent,child,['running','completed','closed'][n%3]);parent=child;
 }
 assert.equal(threads.diagnostics.connectionOpen,false);
 assert.equal(threads.resolveRoot(parent),'root');
 assert.equal(threads.diagnostics.familyQueries,129);
 assert.equal(threads.diagnostics.cachedRoots,129);
 const queries=threads.diagnostics.familyQueries;
 assert.equal(threads.resolveRoot(parent),'root');assert.equal(threads.resolveRoot('child-0'),'root');assert.equal(threads.resolveRoot('root'),'root');
 assert.equal(threads.diagnostics.familyQueries,queries);
 thread('sibling',spawned('child-2'));edge('child-2','sibling','unknown-future-status');
 assert.equal(threads.resolveRoot('sibling'),'root');assert.equal(threads.diagnostics.familyQueries,queries+1);
 thread('fork','cli','root');
 assert.equal(threads.resolveRoot('fork'),'fork');
 assert.equal(threads.diagnostics.connectionOpens,1);
});

test('missing thread records and identified subagents without edges stay retryable',async t=>{
 const {db,threads,thread,edge}=await fixture(t);
 assert.throws(()=>threads.resolveRoot('child'),/THREAD_FAMILY_NOT_READY/);
 thread('child',spawned('root'));
 assert.throws(()=>threads.resolveRoot('child'),/THREAD_FAMILY_NOT_READY/);
 assert.equal(threads.diagnostics.cachedRoots,0);
 edge('root','child');
 assert.throws(()=>threads.resolveRoot('child'),/THREAD_FAMILY_NOT_READY/);
 assert.equal(threads.diagnostics.cachedRoots,0);
 thread('root');
 assert.equal(threads.resolveRoot('child'),'root');
 thread('other',JSON.stringify({subagent:{other:'review'}}));
 assert.throws(()=>threads.resolveRoot('other'),/THREAD_FAMILY_NOT_READY/);
 thread('legacy','subagent');
 assert.throws(()=>threads.resolveRoot('legacy'),/THREAD_FAMILY_NOT_READY/);
 // The source's claimed parent is not a substitute for an official spawn edge.
 db.prepare('UPDATE threads SET source=? WHERE id=?').run(spawned('unrelated'),'child');
 assert.equal(threads.resolveRoot('child'),'root');
});

test('database open failure does not create a database or poison later resolution',async t=>{
 const {path,threads}=await fixture(t,{create:false});
 assert.throws(()=>threads.resolveRoot('root'),/THREAD_DATABASE_UNAVAILABLE/);
 await assert.rejects(readFile(path),{code:'ENOENT'});
 assert.equal(threads.diagnostics.cachedRoots,0);
 const writer=new DatabaseSync(path);
 try{
  writer.exec(schema);writer.exec("INSERT INTO threads VALUES ('root','cli',NULL,'root title','/workspace/root',NULL)");
  assert.equal(threads.resolveRoot('root'),'root');
  assert.equal(threads.diagnostics.connectionOpens,1);
 }finally{threads.close();writer.close();}
});

test('schema failure is explicit and can recover on the same read-only connection',async t=>{
 const {db,threads,thread}=await fixture(t);thread('root');db.exec('DROP TABLE thread_spawn_edges');
 assert.throws(()=>threads.resolveRoot('root'),/THREAD_DATABASE_SCHEMA/);
 assert.equal(threads.diagnostics.cachedRoots,0);
 db.exec('CREATE TABLE thread_spawn_edges(parent_thread_id TEXT,child_thread_id TEXT PRIMARY KEY,status TEXT)');
 assert.equal(threads.resolveRoot('root'),'root');assert.equal(threads.diagnostics.connectionOpens,1);
});

test('a locked database fails explicitly and retries after its writer releases the lock',async t=>{
 const {db,threads,thread}=await fixture(t);thread('root');db.exec('BEGIN EXCLUSIVE');
 try{assert.throws(()=>threads.resolveRoot('root'),/THREAD_DATABASE_READ_FAILED/);assert.equal(threads.diagnostics.cachedRoots,0);}
 finally{db.exec('ROLLBACK');}
 assert.equal(threads.resolveRoot('root'),'root');
});

test('title refresh reads the root and current project using the same connection without refreshing ancestry',async t=>{
 const {db,threads,thread,edge}=await fixture(t);
 db.exec("INSERT INTO projects VALUES ('root-project','Root Project'),('child-project','Child Project')");
 thread('root','cli','Root Task');thread('child',spawned('root'),'Child Task');edge('root','child');
 db.exec("UPDATE threads SET project_id='root-project',cwd='/workspace/root' WHERE id='root';UPDATE threads SET project_id='child-project' WHERE id='child'");
 const root=threads.resolveRoot('child'),queries=threads.diagnostics.familyQueries;
 assert.equal(threads.displayTitle(root,'/workspace/child'),'[Root Project]Root Task');
 db.exec("UPDATE threads SET name='Renamed',project_id=NULL WHERE id='root';INSERT INTO project_roots VALUES ('root-project','/workspace/root')");
 assert.equal(threads.displayTitle(threads.resolveRoot('child')),'[Root Project]Renamed');
 assert.equal(threads.diagnostics.familyQueries,queries);assert.equal(threads.diagnostics.connectionOpens,1);
});

test('reads are read-only and leave no read transaction blocking subsequent writes',async t=>{
 const {path,db,threads,thread}=await fixture(t);thread('root','cli','Root Task');
 const before=await readFile(path);
 assert.equal(threads.resolveRoot('root'),'root');assert.equal(threads.displayTitle('root'),'[default]Root Task');
 assert.deepEqual(await readFile(path),before);
 // Exercise the actual native connection in this disposable fixture: its
 // readOnly option must reject writes, beyond the class exposing read methods.
 assert.throws(()=>threads.db.prepare("UPDATE threads SET name='unexpected' WHERE id='root'").run(),/readonly/i);
 db.exec("UPDATE threads SET name='Writer continued' WHERE id='root'");
 assert.equal(threads.displayTitle('root'),'[default]Writer continued');
 threads.close();assert.equal(threads.diagnostics.connectionOpen,false);threads.close();
 assert.throws(()=>threads.resolveRoot('root'),/THREAD_DATABASE_CLOSED/);
 assert.throws(()=>threads.displayTitle('root'),/THREAD_DATABASE_CLOSED/);
});

test('cyclic edges and malformed JSON source fail without caching an invented root',async t=>{
 const {threads,thread,edge}=await fixture(t);
 thread('a',spawned('b'));thread('b',spawned('a'));edge('a','b');edge('b','a');
 assert.throws(()=>threads.resolveRoot('a'),/THREAD_DATABASE_INVALID_FAMILY/);assert.equal(threads.diagnostics.cachedRoots,0);
 thread('broken','{"subagent":');
 assert.throws(()=>threads.resolveRoot('broken'),/THREAD_DATABASE_SOURCE_INVALID/);assert.equal(threads.diagnostics.cachedRoots,0);
});
