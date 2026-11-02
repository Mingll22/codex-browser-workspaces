#!/usr/bin/env node
// Restore the previous project artifact. State, Windows profile, tabs and global configs are untouched.
import {readFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const destination=resolve(process.argv[2]??'');
if(!process.argv[2])throw new Error('Usage: node scripts/rollback-install.mjs <installed-project-directory>');
const record=JSON.parse(await readFile(join(destination,'installation.json'),'utf8'));
if(record.destination!==destination)throw new Error('Installation receipt mismatch');
const disabled=destination+'-disabled-'+new Date().toISOString().replaceAll(/[:.]/g,'-');
if(record.previous&&!record.previous.startsWith(destination+'-backup-'))throw new Error('Backup receipt mismatch');
await rename(destination,disabled);
if(record.previous)await rename(record.previous,destination);
console.log(JSON.stringify({retained:disabled,restored:record.previous?destination:null,stateRetained:record.stateDir},null,2));
