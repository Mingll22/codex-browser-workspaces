#!/usr/bin/env node
// Writes a reviewed candidate only; never changes browser, Codex DB or runtime state.
import {readFile,writeFile} from 'node:fs/promises';
import {CodexThreads} from '../dist/adapter/src/identity.js';
import {planFamilyMigration} from '../dist/adapter/src/family-migration.js';
const args=process.argv.slice(2),get=key=>args[args.indexOf(key)+1];
if(!args.includes('--input')||!args.includes('--output'))throw new Error('Use --input exact-snapshot.json --output candidate.json');
const threads=new CodexThreads();
try{const result=planFamilyMigration(JSON.parse(await readFile(get('--input'),'utf8')),caller=>threads.resolveRoot(caller));await writeFile(get('--output'),JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({planned:true,groups:result.bindings.length,output:get('--output'),runtimeChanged:false}));}
finally{threads.close();}
