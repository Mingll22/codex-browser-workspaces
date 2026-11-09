#!/usr/bin/env node
// Isolated visual fixture; never contacts a broker or supplies real page data.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const port=Number(process.env.CBW_PREVIEW_PORT??19409);
const root=new URL('../packages/extension/',import.meta.url);
const allowed=new Set(['popup.html','popup.js','popup.css','status.js','icons/icon16.png','icons/icon32.png','icons/icon48.png','icons/icon128.png']);
const fixture=`const listeners=[];const mode=new URL(location.href).searchParams.get('state')||'connected';const base={connection:'CONNECTED',observedAt:Date.now(),extensionVersion:'0.4.0',brokerVersion:'0.4.0',mcpConnections:7,activeThreads:5,workspaces:[{groupId:1,title:'[示例项目]方案评估与资料整理',pageCount:4,leasedPages:2,protectedPages:1},{groupId:2,title:'[示例项目]交互验证',pageCount:2,leasedPages:1,protectedPages:0}]};if(mode==='empty'){base.mcpConnections=0;base.activeThreads=0;base.workspaces=[];}if(mode==='disconnected'){base.connection='DISCONNECTED';base.observedAt-=120000;}if(mode==='error'){base.connection='ERROR';base.error='BROKER_STATUS_TIMEOUT';}if(mode==='long')base.workspaces[0].title='[示例项目]非常长的工作区标题，用于验证扩展窄弹窗中的标题截断与布局稳定性';globalThis.chrome={runtime:{connect:()=>({}),sendMessage:async()=>base,onMessage:{addListener:fn=>listeners.push(fn)}}};globalThis.previewStatus=base;`;
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');const path=url.pathname.slice(1)||'popup.html';
  if(path==='preview.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(fixture);return;}
  if(!allowed.has(path)){res.writeHead(404);res.end();return;}
  let data=await readFile(new URL(path,root));
  if(path==='popup.html')data=Buffer.from(data.toString().replace('<main>','<div style="padding:6px 16px;background:#2d3650;color:#c2d3f5;font:11px system-ui">界面预览 · 示例数据</div><main>').replace('<script type="module" src="popup.js">','<script src="preview.js"></script><script type="module" src="popup.js">'));
  res.writeHead(200,{'Content-Type':path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':path.endsWith('.js')?'text/javascript; charset=utf-8':'image/png','Cache-Control':'no-store'});res.end(data);
 }catch{res.writeHead(500);res.end('Preview unavailable');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Extension UI fixture: http://127.0.0.1:${port}/popup.html`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit()));
