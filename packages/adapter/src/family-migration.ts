import {OperationError} from './operation.js';
import {PageSource} from '../../protocol/src/contracts.js';
interface Receipt {tabId:number;targetId:string;groupId:number;windowId:number}
// Pure planning: the caller must capture all real group members, then apply this
// result under the broker maintenance boundary after rechecking exact receipts.
export function planFamilyMigration(snapshot:{state:any;targets:Receipt[]},resolveRoot:(caller:string)=>string){
  const state=structuredClone(snapshot.state),targets=snapshot.targets;
  if(!state||typeof state.generation!=='string'||!state.workspaces||!Array.isArray(targets))throw new Error('INVALID_MIGRATION_SNAPSHOT');
  const workspaces:Record<string,any>={},families=new Map<string,Set<number>>(),bindings=[];
  for(const [caller,ws] of Object.entries<any>(state.workspaces)){
    const members=targets.filter(receipt=>receipt.groupId===ws.groupId);
    if(!members.length)continue;
    const root=resolveRoot(caller),groups=families.get(root)??new Set<number>();groups.add(ws.groupId);families.set(root,groups);
    for(const [id,tab] of Object.entries<any>(ws.tabs??{})){const actual=members.find(receipt=>receipt.tabId===Number(id));if(actual&&actual.targetId!==tab.targetId)throw new Error('WORKSPACE_UPGRADE_TARGET_CHANGED');}
    bindings.push({caller,root,groupId:ws.groupId});
    const migrated=workspaces[root]??={...ws,tabs:{},windowId:members[0].windowId};
    if(members.some(receipt=>receipt.windowId!==migrated.windowId))throw new Error('WORKSPACE_UPGRADE_TARGET_CHANGED');
    for(const receipt of members){
      const old=ws.tabs?.[receipt.tabId];const external=!old||old.protected||state.protectedTargets?.[receipt.targetId];
      migrated.tabs[receipt.tabId]={...old,targetId:receipt.targetId,slot:old?.slot??null,retained:old?.retained??false,source:external?PageSource.EXTERNAL:(old?.source??PageSource.MANAGED),protected:Boolean(external)};
      if(external){state.protectedTargets??={};state.protectedTargets[receipt.targetId]=true;}
    }
  }
  const conflicts=[...families].filter(([,groups])=>groups.size>1).map(([root,groups])=>({root,groupIds:[...groups]}));
  if(conflicts.length)throw new OperationError('WORKSPACE_FAMILY_MIGRATION_REQUIRED',{conflicts,outcome:'NOT_STARTED',nextAction:'preserve_groups_and_resolve_exact_group_bindings'});
  state.workspaces=workspaces;state.modelVersion=2;
  return {state,targets:structuredClone(targets),bindings};
}
