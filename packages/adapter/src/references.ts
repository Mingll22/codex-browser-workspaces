import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
export function pageHandle(generation:string,targetId:string){return `p:${generation}:${targetId}`;}
export function leasedPageHandle(generation:string,targetId:string,membershipId:string,version:number){return `${pageHandle(generation,targetId)}:${membershipId}:${version}`;}
export function encodeRef(pageId:string,epoch:string,kind:string,raw:string|number){return `${pageId}@${epoch}@${kind}@${raw}`;}
export function decodeRef(value:unknown,pageId:string,epoch:string,kind:string):string|number {
  if(typeof value!=='string'||!value.startsWith(`${pageId}@`))throw new Error('PAGE_NOT_OWNED');
  const prefix=`${pageId}@${epoch}@${kind}@`;
  if(!value.startsWith(prefix))throw new Error('REFERENCE_EXPIRED');
  const raw=value.slice(prefix.length);
  if(kind==='uid'){if(!/^\d+_\d+$/.test(raw))throw new Error('INVALID_REFERENCE');return raw;}
  if(!/^\d+$/.test(raw))throw new Error('INVALID_REFERENCE');return Number(raw);
}
export function inputReferences(args:Record<string,any>,pageId:string,epoch:string){
  const result=structuredClone(args);
  for(const key of ['uid','from_uid','to_uid'])if(result[key]!==undefined)result[key]=decodeRef(result[key],pageId,epoch,'uid');
  if(result.elements)result.elements=result.elements.map((item:any)=>({...item,uid:decodeRef(item.uid,pageId,epoch,'uid')}));
  if(result.args)result.args=result.args.map((id:string)=>decodeRef(id,pageId,epoch,'uid'));
  for(const key of ['reqid','msgid'])if(result[key]!==undefined)result[key]=decodeRef(result[key],pageId,epoch,key);
  return result;
}
export function outputReferences(result:CallToolResult,pageId:string,epoch:string,upstreamId:number):CallToolResult {
  // Use upstream's human-readable content, dropping its unadapted numeric-ID structured duplicate.
  return {isError:result.isError,content:result.content.map(block=>{
    if(block.type!=='text')return block;
    let text=block.text.replace(/^(\s*)uid=(\d+_\d+)/gm,(_,space,uid)=>`${space}uid=${encodeRef(pageId,epoch,'uid',uid)}`)
      .replace(/^(\s*)(reqid|msgid)=(\d+)/gm,(_,space,kind,id)=>`${space}${kind}=${encodeRef(pageId,epoch,kind,id)}`)
      .replace(new RegExp(`^${upstreamId}: `,'gm'),`${pageId}: `);
    return {...block,text};
  })};
}
