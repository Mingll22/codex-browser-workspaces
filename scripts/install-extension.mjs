import {upstream} from './upstream-client.mjs';
const client=await upstream({extensions:true});
try{console.log(JSON.stringify(await client.callTool({name:'install_extension',arguments:{path:process.argv[2]}}),null,2));}finally{await client.close();}
