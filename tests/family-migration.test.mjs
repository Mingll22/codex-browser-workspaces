import test from 'node:test';
import assert from 'node:assert/strict';
import {planFamilyMigration} from '../dist/adapter/src/family-migration.js';
const receipt={tabId:1,targetId:'t1',groupId:3,windowId:2};
const state={generation:'g',workspaces:{child:{groupId:3,windowId:2,tabs:{1:{targetId:'t1',slot:'main'}}}}};
test('migration rekeys a single exact child group to root and protects real unregistered members',()=>{
 const snapshot={state,targets:[receipt,{tabId:2,targetId:'t2',groupId:3,windowId:2}]};
 const output=planFamilyMigration(snapshot,()=> 'root');assert.equal(output.state.modelVersion,2);assert.equal(output.state.workspaces.root.groupId,3);assert.equal(output.state.workspaces.root.tabs[2].protected,true);assert.equal(output.state.workspaces.root.tabs[1].source,'managed');assert.deepEqual(snapshot.state,state);
});
test('migration refuses family group conflicts without moving or discarding either group',()=>{
 const snapshot={state:{...state,workspaces:{...state.workspaces,root:{groupId:4,windowId:2,tabs:{}}}},targets:[receipt,{tabId:2,targetId:'t2',groupId:4,windowId:2}]};
 assert.throws(()=>planFamilyMigration(snapshot,()=> 'root'),e=>e.message==='WORKSPACE_FAMILY_MIGRATION_REQUIRED'&&e.details.conflicts[0].groupIds.length===2);
});
test('migration rejects changed receipts and leaves an empty workspace empty',()=>{
 assert.throws(()=>planFamilyMigration({state,targets:[{...receipt,targetId:'new'}]},()=> 'root'),/WORKSPACE_UPGRADE_TARGET_CHANGED/);
 const output=planFamilyMigration({state:{generation:'g',workspaces:{}},targets:[]},()=>assert.fail());assert.deepEqual(output.state.workspaces,{});assert.equal(output.state.generation,'g');
});
test('closed old records are discarded and whole-group window movement follows real receipts',()=>{
 const moved={...receipt,windowId:7},snapshot={state:{...state,workspaces:{child:{...state.workspaces.child,tabs:{...state.workspaces.child.tabs,9:{targetId:'closed'}}}}},targets:[moved]};
 const output=planFamilyMigration(snapshot,()=> 'root');assert.equal(output.state.workspaces.root.windowId,7);assert.deepEqual(Object.keys(output.state.workspaces.root.tabs),['1']);
 assert.deepEqual(planFamilyMigration({state,targets:[]},()=>assert.fail()).state.workspaces,{});
});
