import {execFileSync} from 'node:child_process';
import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
import {generateKeyPairSync,createHash,randomBytes} from 'node:crypto';
const root=new URL('../',import.meta.url);
await mkdir(new URL('dist/extension/',root),{recursive:true});
await cp(new URL('packages/extension/',root),new URL('dist/extension/',root),{recursive:true});
await cp(new URL('dist/protocol/src/contracts.js',root),new URL('dist/extension/contracts.js',root));
const manifest=JSON.parse(await readFile(new URL('dist/extension/manifest.json',root),'utf8'));
// Public manifest key gives the unpacked extension a stable, origin-checkable ID.
const keyPath=new URL('packages/extension/public-key.txt',root);
let key;
try{key=(await readFile(keyPath,'utf8')).trim();}catch(e){if(e.code!=='ENOENT')throw e;key=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'der'}).toString('base64');await writeFile(keyPath,key+'\n');}
manifest.key=key;
await writeFile(new URL('dist/extension/manifest.json',root),JSON.stringify(manifest,null,2)+'\n');
const extensionId=[...createHash('sha256').update(Buffer.from(key,'base64')).digest('hex').slice(0,32)].map(x=>String.fromCharCode(97+parseInt(x,16))).join('');
await mkdir(new URL('.artifacts/',root),{recursive:true,mode:0o700});
const configPath=new URL('.artifacts/pairing.json',root);
let config;
try{config=JSON.parse(await readFile(configPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;config={url:'ws://127.0.0.1:19227',token:randomBytes(32).toString('hex'),extensionId};await writeFile(configPath,JSON.stringify(config),{mode:0o600});}
if(config.extensionId!==extensionId)throw new Error('Pairing origin differs from manifest key');
await writeFile(new URL('dist/extension/config.js',root),'export const config = '+JSON.stringify({url:config.url,token:config.token})+';\n',{mode:0o600});
console.log('Built extension',extensionId);

const packageInfo=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dirty=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim().length>0;
await writeFile(new URL('dist/build-info.json',root),JSON.stringify({sourceCommit,dirty,version:packageInfo.version,upstream:'1.11.0',pageModelVersion:2,builtAt:new Date().toISOString()},null,2)+'\n');
