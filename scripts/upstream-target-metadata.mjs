// Admin/test preload: expose exact official page object targets in metadata.
// It changes no tool handler or permission. Production uses its scoped build.
import {readFileSync} from 'node:fs';
import {McpResponse} from 'chrome-devtools-mcp/build/src/McpResponse.js';
const base=new URL('../node_modules/chrome-devtools-mcp/',import.meta.url);
if(JSON.parse(readFileSync(new URL('package.json',base))).version!=='1.11.0')throw Error('Unreviewed upstream metadata version');
const source=readFileSync(new URL('build/src/McpResponse.js',base),'utf8');
for(const anchor of ['function createStructuredPage(mcpPage, context, rawTitle)', 'id: mcpPage.id,', 'selected: context.isPageSelected(mcpPage),'])if(source.split(anchor).length!==2)throw Error('Upstream metadata anchor changed');
const original=McpResponse.prototype.format;
McpResponse.prototype.format=async function(context,...args){
 const result=await original.call(this,context,...args);
 for(const key of ['pages','extensionPages'])for(const row of result.structuredContent?.[key]??[]){
  const page=context.getPages().find(page=>page.id===row.id);if(page)row.targetId=page.targetId;
 }
 return result;
};
