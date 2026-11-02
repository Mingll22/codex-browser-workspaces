import {createServer} from 'node:http';
const server=createServer((req,res)=>{
 if(req.url.startsWith('/api')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({fixture:true}));return;}
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
 res.end(`<!doctype html><meta charset="utf-8"><title>CBW acceptance fixture</title><h1>Codex Browser Workspaces acceptance</h1><label>Draft <input aria-label="Draft" id="draft"></label><button id="increment">Increment</button><output id="counter">0</output><button id="popup">Open test popup</button><p id="route"></p><script>document.querySelector('#route').textContent=location.pathname;document.querySelector('#increment').onclick=()=>{document.querySelector('#counter').value=Number(document.querySelector('#counter').value)+1};document.querySelector('#popup').onclick=()=>window.open('/popup','_blank');console.log('CBW fixture ready');fetch('/api');</script>`);
});
server.listen(19228,'127.0.0.1',()=>console.log('Owned fixture on 127.0.0.1:19228'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit()));
