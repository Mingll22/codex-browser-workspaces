import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Journal} from '../dist/adapter/src/journal.js';
test('diagnostics are bounded, persisted and filtered per thread',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'cbw-journal-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'events.json'),journal=new Journal(file,20);await journal.load();
 for(let i=0;i<40;i++)journal.record({event:'request_finished',thread:i%2?'A':'B',requestId:String(i)});
 await journal.flush();const rows=JSON.parse(await readFile(file,'utf8'));assert.equal(rows.length,20);
 const next=new Journal(file,20);await next.load();assert.ok(next.recent('A').every(e=>e.thread==='A'));assert.equal(next.recent('A').length,10);
});

test('the default journal retains the latest 1000 events across reloads', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'cbw-journal-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const file = join(dir, 'events.json');
 const journal = new Journal(file);
 await journal.load();

 for (let i = 0; i <= 1000; i++) {
  journal.record({event: 'request_finished', thread: 'A', requestId: String(i)});
 }
 await journal.flush();
 const expectedIds = Array.from({length: 1000}, (_, i) => String(i + 1));
 const readIds = async () => JSON.parse(await readFile(file, 'utf8')).map(row => row.requestId);
 assert.deepEqual(await readIds(), expectedIds);

 const reloaded = new Journal(file);
 await reloaded.load();
 await reloaded.flush();
 assert.deepEqual(await readIds(), expectedIds);
});
