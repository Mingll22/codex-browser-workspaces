import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,realpath,rm} from 'node:fs/promises';
import {join,win32} from 'node:path';
import {tmpdir} from 'node:os';
import {browserFilePaths} from '../scripts/upstream-upload.mjs';

test('WSL file paths round-trip through Windows paths after root validation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cbw-upload-unit-'));
 try {
  const file=join(root,'中文 file.txt');await writeFile(file,'actual file');const checked=[];
  const context={async validatePath(p){const canonical=await realpath(p);assert.ok(canonical.startsWith(root+'/'));checked.push(canonical);return canonical;}};
  const [native]=await browserFilePaths([file],context);assert.ok(win32.isAbsolute(native));assert.ok(native.endsWith('中文 file.txt'));
  assert.deepEqual(await browserFilePaths([native],context),[native]);assert.deepEqual(checked,[file,file]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('upload rejects inaccessible roots before selecting any file',async()=>{
 await assert.rejects(browserFilePaths(['/etc/hosts'],{async validatePath(){throw Error('OUTSIDE_ROOT');}}),/OUTSIDE_ROOT/);
});
test('missing files and directories never become successful file selections',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cbw-upload-unit-'));
 try {
  const context={async validatePath(p){return p;}};
  await assert.rejects(browserFilePaths([join(root,'missing')],context),/ENOENT/);
  await assert.rejects(browserFilePaths([root],context),/UPLOAD_NOT_A_FILE/);
 }finally{await rm(root,{recursive:true,force:true});}
});
