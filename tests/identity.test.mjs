import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {threadIdentity,Controllers,threadTitle} from '../dist/adapter/src/identity.js';
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const meta=id=>({threadId:id,'x-codex-turn-metadata':{thread_id:id,codex_version:'0.162.1'}});
test('only verified per-call metadata supplies identity',()=>{
 assert.equal(threadIdentity(meta(a)),a);
 for(const value of [undefined,null,[],{}, {thread_id:a}, {threadId:a}, {...meta(a),threadId:'not-a-uuid'}, {...meta(a),'x-codex-turn-metadata':{thread_id:b,codex_version:'0.162.1'}}, {...meta(a),'x-codex-turn-metadata':'invalid'}, {...meta(a),'x-codex-turn-metadata':[]}])assert.throws(()=>threadIdentity(value),/THREAD_IDENTITY_UNAVAILABLE/);
});
test('CLI versions never decide ownership when the identity contract is valid',()=>{
 for(const version of ['0.162.1','0.163.0','1.0.0','0.200.0-alpha.1','other',undefined]) {
  const metadata=meta(a);
  if(version===undefined)delete metadata['x-codex-turn-metadata'].codex_version;
  else metadata['x-codex-turn-metadata'].codex_version=version;
  assert.equal(threadIdentity(metadata),a);
  metadata['x-codex-turn-metadata'].thread_id=b;
  assert.throws(()=>threadIdentity(metadata),/THREAD_IDENTITY_UNAVAILABLE/);
 }
});
test('exclusive controllers, switch releases old identity, reconnect resumes',()=>{
 const c=new Controllers();c.attach('one',a);assert.throws(()=>c.attach('two',a),/THREAD_ALREADY_ATTACHED/);
 c.attach('two',b);assert.throws(()=>c.attach('one',b),/THREAD_ALREADY_ATTACHED/);assert.equal(c.attached(a),true);
 c.detach('two');assert.equal(c.attach('one',b),a);assert.equal(c.attached(a),false);
 c.attach('two',a);c.detach('one');c.attach('three',b);assert.equal(c.attached(b),true);
});
test('missing title database gives ID-based display only',()=>assert.equal(threadTitle(a,'/nonexistent/cbw.db'),'Codex 11111111'));

async function titleFixture(t){
 const dir=await mkdtemp(join(tmpdir(),'cbw-title-')),path=join(dir,'state.sqlite'),db=new DatabaseSync(path);
 db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE project_roots(project_id TEXT,path TEXT);CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT,title TEXT,cwd TEXT,project_id TEXT);');
 t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});return {dir,path,db};
}
test('group label uses explicit Codex project name and current user-renamed thread',async t=>{
 const {db,path}=await titleFixture(t);
 db.prepare('INSERT INTO projects VALUES (?,?)').run('p','产品 平台');
 db.prepare('INSERT INTO threads VALUES (?,?,?,?,?)').run(a,' 修复\n登录 ','old title','/workspace/other','p');
 assert.equal(threadTitle(a,path),'[产品 平台]修复 登录');
 db.prepare('UPDATE threads SET name=? WHERE id=?').run('[产品 平台]验收完成',a);
 assert.equal(threadTitle(a,path),'[产品 平台]验收完成');
 db.prepare('UPDATE threads SET name=? WHERE id=?').run('  ',a);
 assert.equal(threadTitle(a,path),'[产品 平台]old title');
});
test('registered project roots use the longest directory match without sibling-prefix collisions',async t=>{
 const {db,path}=await titleFixture(t);
 db.exec("INSERT INTO projects VALUES ('p','旅行'),('q','管理端');INSERT INTO project_roots VALUES ('p','/workspace/trip'),('q','/workspace/trip/admin');");
 db.prepare('INSERT INTO threads VALUES (?,?,?,?,?)').run(a,null,'修复','/workspace/trip/admin/src',null);
 assert.equal(threadTitle(a,path),'[管理端]修复');
 db.prepare('UPDATE threads SET cwd=? WHERE id=?').run('/workspace/trip-other',a);
 assert.equal(threadTitle(a,path),'[trip-other]修复');
});
test('nested checkout and linked worktree resolve to the original repository name',async t=>{
 const {dir,path,db}=await titleFixture(t),repo=join(dir,'PitchEdge'),git=join(repo,'.git'),work=join(dir,'temporary-branch');
 await mkdir(join(git,'worktrees','topic'),{recursive:true});await mkdir(join(repo,'backend'),{recursive:true});await mkdir(join(work,'src'),{recursive:true});
 await writeFile(join(git,'worktrees','topic','commondir'),'../..\n');await writeFile(join(work,'.git'),'gitdir: '+join(git,'worktrees','topic')+'\n');
 db.prepare('INSERT INTO threads VALUES (?,?,?,?,?)').run(a,null,'修复',join(repo,'backend'),null);
 assert.equal(threadTitle(a,path),'[PitchEdge]修复');
 db.prepare('UPDATE threads SET cwd=? WHERE id=?').run(join(work,'src'),a);
 assert.equal(threadTitle(a,path),'[PitchEdge]修复');
});
test('unpersisted threads use client context and long Unicode labels preserve both components',async t=>{
 assert.equal(threadTitle(a,'/nonexistent/cbw.db','/workspace/admin'),'[admin]Codex 11111111');
 assert.equal(threadTitle(a,'/nonexistent/cbw.db','C:\\Work\\PitchEdge'),'[PitchEdge]Codex 11111111');
 const {db,path}=await titleFixture(t);db.prepare('INSERT INTO projects VALUES (?,?)').run('p','🚀'.repeat(50));
 db.prepare('INSERT INTO threads VALUES (?,?,?,?,?)').run(a,'标题'.repeat(100),'old','/workspace','p');
 const title=threadTitle(a,path);assert.equal(Array.from(title).length,80);assert.ok(title.includes(']标题'));assert.ok(title.endsWith('…'));assert.equal(title.includes('\ufffd'),false);
 db.prepare('UPDATE threads SET name=? WHERE id=?').run('['+'🚀'.repeat(50)+']任务',a);
 const prefixed=threadTitle(a,path);assert.equal(prefixed.split(']').length,2);assert.ok(prefixed.endsWith(']任务'));
});
