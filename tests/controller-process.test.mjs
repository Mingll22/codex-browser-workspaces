import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {controllerProcess,controllerExited} from '../dist/adapter/src/controller-process.js';

test('controller lifetime uses PID plus start time, including forced exit and reused PID',async t=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},10000)'],{stdio:'ignore'});
 await once(child,'spawn');t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
 const owner=controllerProcess(child.pid);assert.equal(controllerExited(owner),false);
 assert.equal(controllerExited({...owner,startTime:'0'}),true);
 const exit=once(child,'exit');child.kill('SIGKILL');await exit;
 assert.equal(controllerExited(owner),true);
 for(const pid of [undefined,null,'123',0,-1,1,1.5])assert.throws(()=>controllerProcess(pid),/INVALID_CONTROLLER_PID/);
});
