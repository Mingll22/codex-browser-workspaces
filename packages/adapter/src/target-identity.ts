import WebSocket from 'ws';
/** Read-only browser target metadata. No attach, navigation, evaluation or page operations. */
export async function openerTarget(browserURL:string,targetId:string):Promise<string|null>{
  const response=await fetch(browserURL+'/json/version',{signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw new Error('BROWSER_UNAVAILABLE');
  const {webSocketDebuggerUrl}=await response.json() as {webSocketDebuggerUrl:string};
  const endpoint=new URL(webSocketDebuggerUrl);
  if(endpoint.hostname!=='127.0.0.1')throw new Error('LOCAL_BROWSER_REQUIRED');
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(endpoint);
    const timer=setTimeout(()=>{socket.terminate();reject(new Error('TARGET_IDENTITY_TIMEOUT'));},5000);
    socket.on('open',()=>socket.send(JSON.stringify({id:1,method:'Target.getTargetInfo',params:{targetId}})));
    socket.on('error',()=>{clearTimeout(timer);reject(new Error('TARGET_IDENTITY_UNAVAILABLE'));});
    socket.on('message',raw=>{
      const message=JSON.parse(raw.toString());if(message.id!==1)return;
      clearTimeout(timer);socket.close();
      if(message.error||message.result?.targetInfo?.targetId!==targetId){reject(new Error('PAGE_GONE'));return;}
      resolve(message.result.targetInfo.openerId??null);
    });
  });
}
