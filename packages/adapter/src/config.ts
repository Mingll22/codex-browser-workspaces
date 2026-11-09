import {homedir} from 'node:os';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import type {Pairing} from './bridge.js';
export interface Config {stateDir:string;socket:string;pairing:Pairing;browserURL:string;maxTabs:number;detachedTtlMs:number|null;closedThreadGraceMs:number|null}
export const defaultState=()=>join(process.env.XDG_STATE_HOME??join(homedir(),'.local/state'),'codex-browser-workspaces');
export async function loadConfig(path=process.env.CBW_CONFIG??join(defaultState(),'config.json')):Promise<Config>{
  const config=JSON.parse(await readFile(path,'utf8')) as Config;
  if(config.closedThreadGraceMs===undefined)config.closedThreadGraceMs=30000;
  if(!config.stateDir.startsWith('/')||!config.socket.startsWith('/')||!Number.isInteger(config.maxTabs)||config.maxTabs<1||config.maxTabs>100)throw new Error('INVALID_CONFIG');
  if(config.detachedTtlMs!==null&&(!Number.isFinite(config.detachedTtlMs)||config.detachedTtlMs<1000))throw new Error('INVALID_TTL');
  if(config.closedThreadGraceMs!==null&&(!Number.isFinite(config.closedThreadGraceMs)||config.closedThreadGraceMs<1000))throw new Error('INVALID_CLOSE_GRACE');
  if(Buffer.byteLength(config.socket)>103)throw new Error('SOCKET_PATH_TOO_LONG');
  const url=new URL(config.browserURL);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:')throw new Error('LOCAL_BROWSER_REQUIRED');
  return config;
}
