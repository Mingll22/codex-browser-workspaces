import test from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/upstream-target-metadata.mjs';
import {McpResponse} from 'chrome-devtools-mcp/build/src/McpResponse.js';
test('admin metadata maps identical URLs by exact official page object IDs',async()=>{
 const pages=[{id:1,targetId:'one',url:()=> 'https://same.test/',getTitle:()=> 'Same'},{id:2,targetId:'two',url:()=> 'https://same.test/',getTitle:()=> 'Same'}];
 const response=new McpResponse({});response.setIncludePages(true);
 const result=await response.format({getPages:()=>pages,getSelectedPageFallback:()=>undefined,getTargetInfos:async()=>new Map(),isPageSelected:page=>page.id===2},{});
 assert.deepEqual(result.structuredContent.pages.map(page=>[page.id,page.targetId]),[[1,'one'],[2,'two']]);
});
