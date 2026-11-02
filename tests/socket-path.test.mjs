import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {prepareSocket} from '../dist/adapter/src/socket-path.js';
test('socket recovery protects live broker and regular files',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'cbw-socket-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'socket');
 await writeFile(path,'keep');await assert.rejects(prepareSocket(path),/SOCKET_PATH_NOT_OWNED/);assert.equal(await readFile(path,'utf8'),'keep');await rm(path);
 const server=createServer(s=>s.end());await new Promise(r=>server.listen(path,r));
 await assert.rejects(prepareSocket(path),/BROKER_ALREADY_RUNNING/);await new Promise(r=>server.close(r));
});
test('owned socket left by crashed fixture is recovered',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'cbw-socket-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'socket');
 const child=spawn(process.execPath,['-e',"require('net').createServer().listen(process.argv[1],()=>process.kill(process.pid,'SIGKILL'))",path],{stdio:'ignore'});await once(child,'exit');assert.equal((await lstat(path)).isSocket(),true);
 await prepareSocket(path);await assert.rejects(lstat(path),{code:'ENOENT'});
});
