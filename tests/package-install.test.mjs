import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,symlink,readlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';

test('public archive and installation survive removal of source and extraction directories',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cbw-package-'));
 try{
  const source=join(root,'source'),unpacked=join(root,'unpacked'),destination=join(root,'installed'),state=join(root,'state');
  for(const dir of ['scripts','docs','dist/extension','node_modules/.bin','node_modules/demo'])await mkdir(join(source,dir),{recursive:true});
  for(const name of ['package.mjs','install.mjs','rollback-install.mjs','deploy-extension.ps1','render-admin-diff.py'])await cp(new URL('../scripts/'+name,import.meta.url),join(source,'scripts',name));
  for(const name of ['INSTALL.md','ARCHITECTURE.md','UPSTREAM.md','ACCEPTANCE.md','HANDOFF.md'])await writeFile(join(source,'docs',name),'fixture documentation');
  for(const name of ['README.md','AGENTS.md','LICENSE','NOTICE'])await writeFile(join(source,name),'fixture file');
  await writeFile(join(source,'package.json'),JSON.stringify({name:'cbw-fixture',version:'0.0.0',type:'module'}));
  await writeFile(join(source,'package-lock.json'),'{}');
  await writeFile(join(source,'dist/extension/manifest.json'),JSON.stringify({key:(await readFile(new URL('../packages/extension/public-key.txt',import.meta.url),'utf8')).trim()}));
  await writeFile(join(source,'dist/extension/config.js'),'fixture pairing must not be distributed');
  await writeFile(join(source,'node_modules/demo/index.js'),"console.log('fixture-bin')");
  await symlink('../demo/index.js',join(source,'node_modules/.bin/demo'));
  execFileSync(process.execPath,[join(source,'scripts/package.mjs')]);
  const archive=join(source,'.artifacts/codex-browser-workspaces-0.0.0.tar.gz');
  const names=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).split('\n');
  for(const name of ['./dist/extension/config.js','./docs/HANDOFF.md','./AGENTS.md'])assert.ok(!names.includes(name),name);
  for(const name of ['./LICENSE','./NOTICE','./docs/INSTALL.md','./scripts/install.mjs'])assert.ok(names.includes(name),name);
  await mkdir(unpacked);execFileSync('tar',['-xzf',archive,'-C',unpacked]);
  assert.equal(await readlink(join(unpacked,'node_modules/.bin/demo')),'../demo/index.js');
  execFileSync(process.execPath,[join(unpacked,'scripts/install.mjs'),'--destination',destination,'--state-dir',state,'--port','19277'],{env:{...process.env,XDG_RUNTIME_DIR:join(root,'runtime')}});
  assert.equal(isAbsolute(await readlink(join(destination,'node_modules/.bin/demo'))),false);
  const config=JSON.parse(await readFile(join(state,'config.json'),'utf8'));
  assert.ok(config.pairing.token.length>=32);assert.equal(config.stateDir,state);
  await rm(source,{recursive:true});await rm(unpacked,{recursive:true});
  assert.equal(execFileSync(process.execPath,[join(destination,'node_modules/.bin/demo')],{encoding:'utf8'}).trim(),'fixture-bin');
 }finally{await rm(root,{recursive:true,force:true});}
});
