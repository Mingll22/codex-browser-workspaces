// Admin-only: apply a reviewed exact-state migration or rollback plan.
import {readFile} from 'node:fs/promises';
import {extensionTestClient} from './extension-test-client.mjs';
import {stageFamilyState} from './family-upgrade-state.mjs';
const targetId=process.argv[2],index=process.argv.indexOf('--family-plan');
if(!/^[A-F0-9]{32}$/.test(targetId??'')||index<0)throw Error('Use OWNED_TARGET_ID --family-plan reviewed-plan.json');
const plan=JSON.parse(await readFile(process.argv[index+1],'utf8'));
const extension=await extensionTestClient(targetId);
try{console.log(JSON.stringify(await extension.evaluate(`async()=>(${stageFamilyState.toString()})(${JSON.stringify(plan)})`),null,2));}
finally{await extension.close();}
