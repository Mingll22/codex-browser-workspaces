// A minimized Chrome window can stop presenting compositor surfaces. A tiny
// screencast keeps this owned page producing frames while the official
// screenshot runs. It never restores a window or changes OS focus.
export async function beginMinimizedCapture(page,signal) {
 const client=page._client();
 const {bounds}=await client.send('Browser.getWindowForTarget');
 if(bounds.windowState!=='minimized')return;
 if(signal?.aborted)throw new Error('REQUEST_CANCELLED');
 await client.send('Page.startScreencast',{format:'jpeg',quality:0,maxWidth:1,maxHeight:1,everyNthFrame:1});
 let stopped;
 const stop=()=>{
  signal?.removeEventListener('abort',abort);
  return stopped??=client.send('Page.stopScreencast');
 };
 // The caller may stop waiting while Chrome still has a pending screenshot.
 // Stop this frame producer on cancellation too; finally awaits the same result.
 const abort=()=>{void stop().catch(()=>{});};
 signal?.addEventListener('abort',abort,{once:true});
 if(signal?.aborted){await stop();throw new Error('REQUEST_CANCELLED');}
 return {[Symbol.asyncDispose]:stop};
}
