import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stageFamilyState} from '../scripts/family-upgrade-state.mjs';
function fixture(failOnce=false){
 let session={state:{generation:'g',workspaces:{child:{groupId:3}}}},local={};const moves=[];
 const chrome={storage:{session:{get:async()=>structuredClone(session),set:async value=>{Object.assign(session,structuredClone(value));if(failOnce){failOnce=false;throw Error('MCP_RESPONSE_LOST');}}},local:{set:async value=>Object.assign(local,structuredClone(value))}},tabs:{query:async query=>[{id:1,groupId:3,windowId:2}].filter(tab=>tab.groupId===query.groupId)},debugger:{getTargets:async()=>[{tabId:1,id:'t',type:'page'}]}};
 const context=vm.createContext({chrome});
 return {session,local,moves,run:plan=>vm.runInContext(`(${stageFamilyState.toString()})(${JSON.stringify(plan)})`,context)};
}
test('forward migration and rollback restore both session and explicit reload state without moving pages',async()=>{
 const f=fixture(),old=structuredClone(f.session.state),targets=[{tabId:1,targetId:'t',groupId:3,windowId:2}],next={generation:'g',modelVersion:2,workspaces:{root:{groupId:3}}};
 await f.run({state:next,targets});assert.deepEqual(f.session.state,next);assert.deepEqual(f.local.workspaceUpgrade.state,next);
 await f.run({state:old,targets});assert.deepEqual(f.session.state,old);assert.deepEqual(f.local.workspaceUpgrade.state,old);assert.deepEqual(f.moves,[]);
});
test('changed membership or generation rejects before writing any extension state',async()=>{
 const f=fixture(),old=structuredClone(f.session.state);
 for(const plan of [{state:{...old,generation:'new'},targets:[]},{state:old,targets:[{tabId:1,targetId:'wrong',groupId:3,windowId:2}]}])await assert.rejects(f.run(plan),/WORKSPACE_UPGRADE_TARGET_CHANGED/);
 assert.deepEqual(f.session.state,old);assert.deepEqual(f.local,{});
});

test('an uncertain state write remains restorable through the saved original exact plan',async()=>{
 const f=fixture(true),old=structuredClone(f.session.state),targets=[{tabId:1,targetId:'t',groupId:3,windowId:2}],next={generation:'g',modelVersion:2,workspaces:{root:{groupId:3}}};
 await assert.rejects(f.run({state:next,targets}),/MCP_RESPONSE_LOST/);assert.deepEqual(f.session.state,next);
 await f.run({state:old,targets});assert.deepEqual(f.session.state,old);assert.deepEqual(f.local.workspaceUpgrade.state,old);
});
