import {HttpError} from './security.js';
import {settingsFor,createYougileClient,readYougileScope} from './yougile.js';
import {SyncConflict,stateEqual,SYNC_FIELDS,localSnapshot,remoteSnapshot,remotePatch,mergeTask,assertIncomingStatus} from './yougile-merge.js';
export class SyncBudget extends Error {}
export async function syncYougile(settings,callRpc,fetchImpl=fetch,clock=()=>Date.now()){
 settings=settingsFor(settings);
 const db=(action,data={})=>callRpc('dvfm_yg',{p_actor:null,p_action:action,p_data:data});
 const claim=await db('run.claim');
 if(claim.busy)return {busy:true};
 if(!claim.lease)return {enabled:false};
 const lease=claim.lease,cfg=claim.config,start=clock();
 const call=(action,data={})=>db(action,{lease,...data});
 const summary={enabled:true,pushed:0,pulled:0,imported:0,conflicts:0,retried:0,limited:false};
 try{
  if(settings.projectId!==cfg.remote_project||settings.boardId!==cfg.board_id)throw new HttpError(503,'Настройки Secrets и выбранной связи YouGile не совпадают');
  const client=createYougileClient(settings,fetchImpl,async()=>{if(clock()-start>45000||!await call('permit')||clock()-start>45000)throw new SyncBudget();});
  const scope=await readYougileScope(client);
  if(Object.values(cfg.columns).some(id=>!scope.columns.some(c=>c.id===id)))throw new HttpError(409,'Колонки YouGile изменились. Проверьте настройки связи');
  const users=claim.users.filter(u=>scope.memberIds.includes(u.remote_user));
  const projectRemote=t=>remoteSnapshot(t,cfg.columns,users);
  async function issue(taskId,error,remote=null){
   if(error instanceof SyncBudget)throw error;
   if(error?.code==='YG404')error=new SyncConflict('remote_removed');
   if(error instanceof SyncConflict||error?.code==='22023'||error?.code==='40001'||error?.code==='42501'){
    await call('conflict',{task_id:taskId,reason:error.reason||(error.code==='22023'?'crm_transition_rejected':error.code==='40001'?'local_changed':'authority_or_assignee_changed'),fields:error.fields||[],remote});
    summary.conflicts++;
   }else{await call('retry',{task_id:taskId});summary.retried++;}
  }
  async function reconcile(item,remoteObject){
   const {task,link}=item;let remote=null;
   try{
    await call('validate',{task_id:task.id,version:task.version});
    if(!users.some(u=>u.employee_id===task.assignee_id))throw new SyncConflict('unbound_assignee',['assignee_id']);
    if(!link.remote_id){
     const local=localSnapshot(task),payload=remotePatch(local,SYNC_FIELDS,cfg.columns,users,null);
     // Null deadline is omitted on create; {deleted:true} is only an update operation.
     if(local.due_date===null)delete payload.deadline;
     const created=await client.createTask({...payload,idempotencyKey:'dvfm-'+cfg.project_id+'-'+task.id});
     const object=await client.task(created.id);remote=projectRemote(object);
     if(!stateEqual({...remote,status:local.status==='accepted'&&remote.status==='pending'?'accepted':remote.status},local)){await call('ack',{task_id:task.id,remote_id:object.id,version:task.version,local,remote});throw new SyncConflict('remote_changed_after_create');}
     await call('ack',{task_id:task.id,remote_id:object.id,version:task.version,local,remote});summary.pushed++;return;
    }
    const observed=remoteObject||await client.task(link.remote_id);remote=projectRemote(observed);
    const plan=mergeTask(task,remote,link);
    if(plan.pull.length)assertIncomingStatus(task,plan.desired);
    let finalObject=observed,finalRemote=remote;
    if(plan.push.length){
     const latest=await client.task(link.remote_id);
     if(!stateEqual(projectRemote(latest),remote))throw new SyncConflict('remote_changed_before_write');
     const patch=remotePatch(plan.desired,plan.push,cfg.columns,users,latest);
     await call('validate',{task_id:task.id,version:task.version});
     await client.updateTask(link.remote_id,patch);
     finalObject=await client.task(link.remote_id);finalRemote=projectRemote(finalObject);
     const expected={...remote};for(const key of plan.push)expected[key]=key==='status'&&plan.desired.status==='accepted'?'pending':plan.desired[key];
     remote=finalRemote;
     if(!stateEqual(finalRemote,expected))throw new SyncConflict('remote_changed_after_write');
     summary.pushed++;
    }
    if(plan.pull.length){await call('pull',{task_id:task.id,remote_id:link.remote_id,version:task.version,desired:plan.desired,remote:finalRemote});summary.pulled++;}
    else await call('ack',{task_id:task.id,remote_id:link.remote_id,version:task.version,local:localSnapshot(task),remote:finalRemote});
   }catch(error){await issue(task.id,error,remote);}
  }
  const work=await call('work');
  for(const item of work)await reconcile(item);
  const watched=await call('watch');
  for(const item of watched){await reconcile(item);await call('watch.advance',{task_id:item.task.id});}
  if(watched.length<5)await call('watch.advance',{task_id:null});
  const allowImport=cfg.import_new&&await call('allow_import');
  if(cfg.import_new&&!allowImport)summary.import_waiting_for_creates=true;
  const columnIds=['pending','in_progress','review','done','cancelled'].filter(key=>cfg.columns[key]).map(key=>cfg.columns[key]),index=cfg.scan_column%columnIds.length;
  const page=await client.get('/task-list?'+new URLSearchParams({columnId:columnIds[index],limit:'5',offset:String(cfg.scan_offset)}));
  if(!Array.isArray(page.content)||page.content.length>5||typeof page.paging?.next!=='boolean'||page.paging.next&&page.content.length===0)throw new HttpError(502,'Некорректная страница задач YouGile');
  for(const candidate of page.content){
   const item=await call('lookup',{remote_id:candidate.id});
   // A conflict is explicit state; polling must not resolve it on its own.
   if(item&&(item.link.conflict&&!item.link.resolution||item.link.attempts>=10||new Date(item.link.retry_at).getTime()>Date.now()))continue;
   if(!item&&(!allowImport||candidate.deleted||candidate.archived))continue;
   const remoteObject=await client.task(candidate.id);
   if(item){await reconcile(item,remoteObject);continue;}
   try{const remote=projectRemote(remoteObject);const result=await call('import',{remote_id:remoteObject.id,remote});if(result&&!result.existing)summary.imported++;}
   catch(error){
    if(error instanceof SyncBudget)throw error;
    // Unmapped external objects must be visible to the operator, not silently assigned.
    if(error instanceof SyncConflict){summary.conflicts++;await call('scan.error',{remote_id:candidate.id,reason:error.reason});continue;}
    throw error;
   }
  }
  await call('scan.advance',{column:page.paging.next?index:(index+1)%columnIds.length,offset:page.paging.next?cfg.scan_offset+page.content.length:0});
 }catch(error){if(error instanceof SyncBudget)summary.limited=true;else throw error;}
 finally{try{await call('run.release');}catch{/* Lease expires; never log credentials or task bodies. */}}
 return summary;
}
