import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const stateDir=fileURLToPath(new URL('.artifacts/runtime/',root));
await mkdir(stateDir,{recursive:true,mode:0o700});
const pairing=JSON.parse(await readFile(new URL('.artifacts/pairing.json',root),'utf8'));
const config={stateDir,socket:stateDir+'broker.sock',pairing,browserURL:'http://127.0.0.1:9222',maxTabs:8,detachedTtlMs:null};
await writeFile(new URL('.artifacts/dev-config.json',root),JSON.stringify(config,null,2)+'\n',{mode:0o600});
console.log('Prepared .artifacts/dev-config.json; no global configuration changed');
