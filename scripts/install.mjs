#!/usr/bin/env node
import {mkdir,cp,readFile,writeFile,rename,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
const args=process.argv.slice(2);
function option(key,fallback){const index=args.indexOf(key);return index<0?fallback:args[index+1];}
const source=fileURLToPath(new URL('../',import.meta.url));
const destination=resolve(option('--destination',join(process.env.XDG_DATA_HOME??join(homedir(),'.local/share'),'codex-browser-workspaces')));
const stateDir=resolve(option('--state-dir',join(process.env.XDG_STATE_HOME??join(homedir(),'.local/state'),'codex-browser-workspaces')));
const port=Number(option('--port','19227'));if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid bridge port');
if(destination===resolve(source)||destination.startsWith(resolve(source)+'/dist/'))throw new Error('Install destination cannot overwrite source/build output');
const stamp=new Date().toISOString().replaceAll(/[:.]/g,'-');
let previous=null;
try{await stat(destination);previous=destination+'-backup-'+stamp;}catch(e){if(e.code!=='ENOENT')throw e;}
const staging=destination+'-staging-'+stamp;
await mkdir(staging,{recursive:true,mode:0o700});
for(const path of ['dist','node_modules','package.json','package-lock.json','scripts','docs'])await cp(join(source,path),join(staging,path),{recursive:true,verbatimSymlinks:true});
await mkdir(stateDir,{recursive:true,mode:0o700});
const configPath=join(stateDir,'config.json');
let config;
try{config=JSON.parse(await readFile(configPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const manifest=JSON.parse(await readFile(join(staging,'dist/extension/manifest.json'),'utf8'));
const extensionId=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32)].map(c=>String.fromCharCode(97+parseInt(c,16))).join('');
if(!config){
 const runtime=process.env.XDG_RUNTIME_DIR?join(process.env.XDG_RUNTIME_DIR,'codex-browser-workspaces'):stateDir;
 config={stateDir,socket:join(runtime,'broker.sock'),pairing:{url:`ws://127.0.0.1:${port}`,extensionId,token:randomBytes(32).toString('hex')},browserURL:'http://127.0.0.1:9222',maxTabs:8,detachedTtlMs:null};
 await writeFile(configPath,JSON.stringify(config,null,2)+'\n',{mode:0o600});
}
if(config.stateDir!==stateDir||config.pairing.extensionId!==extensionId)throw new Error('Existing installation configuration does not match destination state/extension');
await writeFile(join(staging,'dist/extension/config.js'),'export const config = '+JSON.stringify({url:config.pairing.url,token:config.pairing.token})+';\n',{mode:0o600});
const toml=`# Replace the existing raw entry with this block; do not expose both.\n[mcp_servers.chrome-devtools]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify([join(destination,'dist/adapter/src/stdio.js'),configPath])}\nstartup_timeout_sec = 15\ntool_timeout_sec = 90\n`;
await writeFile(join(staging,'admin-mcp.toml'),toml);
const quote=value=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
const unit=`[Unit]\nDescription=Codex Browser Workspaces (local)\n\n[Service]\nType=simple\nExecStart=${[process.execPath,join(destination,'dist/adapter/src/broker.js'),configPath].map(quote).join(' ')}\nWorkingDirectory=${destination}\nRestart=on-failure\nRestartSec=3\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`;
await writeFile(join(staging,'codex-browser-workspaces.service'),unit);
await writeFile(join(staging,'installation.json'),JSON.stringify({destination,stateDir,configPath,previous,installedAt:new Date().toISOString()},null,2)+'\n');
if(args.includes('--stage-only')){console.log(JSON.stringify({staging,destination,stateDir,previous,config:configPath}));process.exit(0);}
if(previous)await rename(destination,previous);
try{await rename(staging,destination);}catch(error){if(previous)await rename(previous,destination);throw error;}
console.log(JSON.stringify({destination,stateDir,previous,config:configPath,globalConfigurationChanged:false},null,2));
