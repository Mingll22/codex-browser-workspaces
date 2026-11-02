import {readFile} from 'node:fs/promises';
import {extensionTestClient} from './extension-test-client.mjs';
const targetId=process.argv[2];if(!/^[A-F0-9]{32}$/.test(targetId??''))throw new Error('Pass a verified owned target ID');
const ext=await extensionTestClient(targetId);
try{console.log(await ext.evaluate('()=>{setTimeout(()=>chrome.runtime.reload(),100);return "reload scheduled"}'));}finally{await ext.close();}
