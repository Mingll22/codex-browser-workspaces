import {cp,readFile,writeFile,mkdir} from 'node:fs/promises';
const source=new URL('../node_modules/chrome-devtools-mcp/',import.meta.url);
const dest=new URL('../dist/upstream/',import.meta.url);
const pkg=JSON.parse(await readFile(new URL('package.json',source),'utf8'));
await import('./upstream-target-metadata.mjs'); // Validate the explicit admin metadata adapter too.
if(pkg.version!=='1.11.0')throw new Error('Unreviewed upstream version: '+pkg.version);
await mkdir(dest,{recursive:true});
await cp(source,dest,{recursive:true});
async function patchFile(relative,replacements) {
 const file=new URL(relative,dest);let value=await readFile(file,'utf8');
 for(const [before,after] of replacements){if(value.split(before).length!==2)throw new Error('Upstream scope patch anchor changed: '+relative+' '+before.slice(0,60));value=value.replace(before,after);}
 const notice='// Modified by Codex Browser Workspaces; see docs/UPSTREAM.md in the distribution.\n';
 await writeFile(file,value.startsWith(notice)?value:notice+value);
}
await writeFile(new URL('build/src/WorkspaceScope.js',dest),`import {AsyncLocalStorage} from 'node:async_hooks';
export const workspaceScope=new AsyncLocalStorage();
const queues=new Map();
export function workspaceCheckpoint(){
 const control=workspaceScope.getStore()?.control;
 if(control?.signal?.aborted)throw new Error('REQUEST_CANCELLED');
 if(control?.deadline&&Date.now()>=control.deadline)throw new Error('REQUEST_TIMEOUT');
}
export async function acquireWorkspacePage(key){
 workspaceCheckpoint();
 const prior=queues.get(key)??Promise.resolve();
 let release;const next=new Promise(resolve=>{release=resolve});queues.set(key,next);
 let released=false;
 const dispose=()=>{if(released)return;released=true;release();if(queues.get(key)===next)queues.delete(key);};
 const control=workspaceScope.getStore()?.control;
 let timer,abort;
 try{
  await new Promise((resolve,reject)=>{
   abort=()=>reject(new Error('REQUEST_CANCELLED'));
   control?.signal?.addEventListener('abort',abort,{once:true});
   if(control?.signal?.aborted)abort();
   if(control?.deadline)timer=setTimeout(()=>reject(new Error('REQUEST_TIMEOUT')),Math.max(1,control.deadline-Date.now()));
   prior.then(resolve,reject);
  });
  workspaceCheckpoint();
 }catch(error){void prior.then(dispose,dispose);throw error;}
 finally{clearTimeout(timer);control?.signal?.removeEventListener('abort',abort);}
 return {[Symbol.dispose]:dispose};
}
`);
await cp(new URL('upstream-upload.mjs',import.meta.url),new URL('build/src/WorkspaceUpload.js',dest));
await cp(new URL('upstream-capture.mjs',import.meta.url),new URL('build/src/WorkspaceCapture.js',dest));
await patchFile('build/src/tools/screenshot.js',[
 ["import { zod }", "import { beginMinimizedCapture } from '../WorkspaceCapture.js';\nimport { workspaceScope } from '../WorkspaceScope.js';\nimport { zod }"],
 ['                const page = request.page.pptrPage;', '                const page = request.page.pptrPage;\n                __addDisposableResource(env_1, await beginMinimizedCapture(page, workspaceScope.getStore()?.control?.signal), true);'],
 ['                __disposeResources(env_1);', '                await __disposeResources(env_1);']
]);
await patchFile('build/src/McpResponse.js',[
 ['            this.#includeExtensionServiceWorkers = value;', '            this.#includeExtensionServiceWorkers = false; // Page ownership never grants access to extension workers.'],
 ['        id: mcpPage.id,\n        url: mcpPage.url(),','        id: mcpPage.id,\n        targetId: mcpPage.targetId,\n        url: mcpPage.url(),'],
 ['        if (dialog) {','        if (dialog && !dialog.handled) {']
]);
const contextPath=new URL('build/src/McpContext.js',dest);
await writeFile(contextPath,"import { workspaceScope } from './WorkspaceScope.js';\n"+await readFile(contextPath,'utf8'));
await patchFile('build/src/McpContext.js',[
 ['return Array.from(this.#mcpPages.values());',"return Array.from(this.#mcpPages.values()).filter(p => workspaceScope.getStore()?.has(p.targetId));"],
 ['        const page = this.#selectedPage;','        const page = this.getPages().find(p => p === this.#selectedPage);'],
 ['        const targetPage = page ?? this.#selectedPage;','        const targetPage = page;'],
 ['const page = this.#mcpPages.values().find(mcpPage => mcpPage.id === pageId);','const page = this.getPages().find(mcpPage => mcpPage.id === pageId);'],
 ['        return this.#selectedPageFallback;','        return undefined;'],
 ['        let targetPage = page;','        if (!page) return undefined;\n        let targetPage = page;']
]);
await patchFile('build/src/ToolHandler.js',[
 ["import { McpResponse }", "import { workspaceScope, acquireWorkspacePage, workspaceCheckpoint } from './WorkspaceScope.js';\nimport { browserFilePaths } from './WorkspaceUpload.js';\nimport { McpResponse }"],
 ['this.registeredInputSchema = zod.object(this.inputSchema).strict();',`this.registeredInputSchema = zod.object({...this.inputSchema,
         __cbwTargetIds:zod.array(zod.string()), __cbwDeadline:zod.number()}).strict();`],
 ['    handle = async (params) => {',`    handle = async (params, extra) => {
        const {__cbwTargetIds, __cbwDeadline, ...scopedParams} = params;
        if (!Array.isArray(__cbwTargetIds) || !__cbwTargetIds.every(id => typeof id === 'string')) {
            return {content:[{type:'text',text:'WORKSPACE_SCOPE_REQUIRED'}],isError:true};
        }
        const scope=new Set(__cbwTargetIds);scope.control={signal:extra?.mcpReq?.signal,deadline:__cbwDeadline};
        return workspaceScope.run(scope, () => this.handleScoped(scopedParams));
    };
    handleScoped = async (params) => {`],
 ['            const guard = __addDisposableResource(env_1, await this.toolMutex.acquire(), false);',`            workspaceCheckpoint();
            const shared = await this.toolMutex.acquire();
            let released = false;
            const guard = __addDisposableResource(env_1, {[Symbol.dispose]() {if (!released) {released=true;shared[Symbol.dispose]();}}}, false);`],
 ['                const context = await this.#raceWithTimeout', '                workspaceCheckpoint();\n                const context = await this.#raceWithTimeout'],
 ['                logger?.(`${this.tool.name} context: resolved`);',`                guard[Symbol.dispose]();
                __addDisposableResource(env_1, await acquireWorkspacePage(this.tool.name==='handle_dialog' ? 'dialog:'+params.pageId : params.pageId ?? 'metadata'), false);
                logger?.(this.tool.name+' context: resolved');`],
 ['                    await validateToolFiles(this.tool, params, context);',`                    workspaceCheckpoint();
                    if (typeof params.pageId==='number') {
                        page=context.getPageById(params.pageId);
                        await page.init();
                        response.setPage(page);
                        if (this.tool.name!=='handle_dialog') page.throwIfDialogOpen();
                    }
                    if(this.tool.name==='upload_file') params.filePaths=await browserFilePaths(params.filePaths,context);
                    else await validateToolFiles(this.tool, params, context);`],
 ['                        await this.tool.handler({\n                            params,\n                            page,','                        workspaceCheckpoint();\n                        await this.tool.handler({\n                            params,\n                            page,'],
 ['                        await this.tool.handler({\n                            params,\n                        },','                        workspaceCheckpoint();\n                        await this.tool.handler({\n                            params,\n                        },']
]);
await patchFile('build/src/tools/script.js',[
 ['                const page = mcpPage.pptrPage;', '                mcpPage.throwIfDialogOpen();\n                const page = mcpPage.pptrPage;'],
 ["                }, { handleDialog: dialogAction ?? 'accept', waitForStableDom });", "                }, { handleDialog: dialogAction ?? 'accept', waitForStableDom });\n                if (result.dialogHandled) mcpPage.clearDialog();"]
]);
await patchFile('build/src/tools/input.js',[
 ["File uploaded from ${filePaths.join(', ')}.","Files selected from ${filePaths.join(', ')}. Submit the form and verify the receiver to confirm upload."]
]);
console.log('Patched official 1.11.0: ownership, per-page scheduling, dialog recovery and Windows/WSL uploads');
// A dismissed beforeunload is a completed decision, not a navigation timeout.
// Puppeteer's navigation watcher already supports cancellation; pass it through goto too.
await patchFile('build/src/third_party/index.js',[
 ["referrerPolicy = this._frameManager.networkManager.extraHTTPHeaders()['referer-policy'], waitUntil = ['load'], timeout = this._frameManager.timeoutSettings.navigationTimeout(), } = options;", "referrerPolicy = this._frameManager.networkManager.extraHTTPHeaders()['referer-policy'], waitUntil = ['load'], timeout = this._frameManager.timeoutSettings.navigationTimeout(), signal, } = options;"],
 ['let ensureNewDocumentNavigation = false;\n            const watcher = new LifecycleWatcher(this._frameManager.networkManager, this, waitUntil, timeout);','let ensureNewDocumentNavigation = false;\n            const watcher = new LifecycleWatcher(this._frameManager.networkManager, this, waitUntil, timeout, signal);']
]);
const pagesPath=new URL('build/src/tools/pages.js',dest);
let pages=await readFile(pagesPath,'utf8');
const begin=pages.indexOf('export const navigatePage ='),end=pages.indexOf('export const resizePage =');
let navigation=pages.slice(begin,end);
function navReplace(before,after){if(navigation.split(before).length!==2)throw Error('Navigation patch anchor changed: '+before);navigation=navigation.replace(before,after);}
navReplace('Default is accept.','Default is dismiss to preserve unsaved input. Pass accept explicitly to leave the page.');
navReplace("request.params.handleBeforeUnload ?? 'accept'", "request.params.handleBeforeUnload ?? 'dismiss'");
navReplace('            let initScriptId;',`            const controller = new AbortController();
            options.signal = controller.signal;
            let cancelled = false;
            const onDialogOpened = dialog => {
                if (dialog.type()==='beforeunload' && (request.params.handleBeforeUnload ?? 'dismiss')==='dismiss') cancelled=true;
            };
            const onDialogClosed = event => {
                if (!event.result && page.getDialog()?.type()==='beforeunload') {
                    cancelled = true;
                    controller.abort(new Error('Navigation cancelled by beforeunload decision'));
                }
            };
            const client=page.pptrPage._client();
            let initScriptId;`);
navReplace("                const action = request.params.handleBeforeUnload", "                client.on('Page.javascriptDialogClosed',onDialogClosed);\n                page.pptrPage.on('dialog',onDialogOpened);\n                const action = request.params.handleBeforeUnload");
for(const verb of ['navigate in','navigate back in','navigate forward in','reload']){
 const before='response.appendResponseLine(`Unable to '+verb+' the selected page: ${error.message}.`);';
 navReplace(before,"if (cancelled) response.appendResponseLine('Navigation cancelled; the page and unsaved input were preserved.'); else throw error;");
}
navReplace('            finally {',"            finally {\n                client.off('Page.javascriptDialogClosed',onDialogClosed);\n                page.pptrPage.off('dialog',onDialogOpened);");
pages=pages.slice(0,begin)+navigation+pages.slice(end);await writeFile(pagesPath,'// Modified by Codex Browser Workspaces; see docs/UPSTREAM.md in the distribution.\n'+pages);
await patchFile('build/src/utils/WaitForHelper.js',[
 ['    #dialogHandled = false;','    #dialogHandled = false;\n    #navigationDismissed = false;'],
 ["                if (actionToTake === 'dismiss') {", "                if (actionToTake === 'dismiss') {\n                    this.#navigationDismissed = dialog.type()==='beforeunload';"],
 ['            if (navigationStarted) {','            if (navigationStarted && !this.#navigationDismissed) {']
]);
