import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
test('MV3 worker has synchronous module evaluation and listener registration',()=>{
 const source=ts.createSourceFile('worker.js',readFileSync('packages/extension/worker.js','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const topLevelAwait=[];
 function visit(node,inFunction=false){
  if(ts.isAwaitExpression(node)&&!inFunction)topLevelAwait.push(source.getLineAndCharacterOfPosition(node.pos).line+1);
  ts.forEachChild(node,child=>visit(child,inFunction||ts.isFunctionLike(node)));
 }
 visit(source);
 assert.deepEqual(topLevelAwait,[],'ServiceWorker modules prohibit top-level await');
});
