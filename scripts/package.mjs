import {mkdir,cp,rm,readFile,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const stage=root+'/.artifacts/release';await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true,mode:0o700});
for(const path of ['dist','node_modules','package.json','package-lock.json','README.md'])await cp(root+'/'+path,stage+'/'+path,{recursive:true,verbatimSymlinks:true});
await mkdir(stage+'/docs',{recursive:true});
for(const name of ['INSTALL.md','ARCHITECTURE.md','UPSTREAM.md','ACCEPTANCE.md','COMPARISON.md']){
 const source=root+'/docs/'+name;
 if(name==='COMPARISON.md'&&!existsSync(source))continue;
 await cp(source,stage+'/docs/'+name);
}
for(const entry of await readdir(root,{withFileTypes:true})){
 if(entry.isFile()&&/^(LICENSE|LICENCE|NOTICE|COPYING)(?:[.-].*)?$/i.test(entry.name))await cp(root+'/'+entry.name,stage+'/'+entry.name);
}
await mkdir(stage+'/scripts',{recursive:true});
// Prebuilt archives support install/rollback. upgrade.mjs requires the source
// checkout, build scripts and tests; it is intentionally not shipped here.
for(const script of ['install.mjs','rollback-install.mjs','deploy-extension.ps1','render-admin-diff.py'])await cp(root+'/scripts/'+script,stage+'/scripts/'+script);
// Pairing material is installation-specific and must never enter the distributable.
await rm(stage+'/dist/extension/config.js',{force:true});
const pkg=JSON.parse(await readFile(root+'/package.json','utf8'));
const archive=root+`/.artifacts/codex-browser-workspaces-${pkg.version}.tar.gz`;
execFileSync('tar',['-czf',archive,'-C',stage,'.']);
console.log(archive);
