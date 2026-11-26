export const SYNC_FIELDS=['title','description','assignee_id','status','due_date'];
export class SyncConflict extends Error {constructor(reason,fields=[]){super(reason);this.reason=reason;this.fields=fields;}}
export function stateEqual(a,b){
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const keysA=Object.keys(a).sort(),keysB=Object.keys(b).sort();
 return keysA.length===keysB.length&&keysA.every((key,index)=>key===keysB[index]&&stateEqual(a[key],b[key]));
}
const mergeEqual=stateEqual;
const escapeText=text=>String(text).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const decodeText=text=>String(text).replace(/&(amp|lt|gt|quot|#39);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
export const localSnapshot=t=>Object.fromEntries(SYNC_FIELDS.map(k=>[k,t[k]??(k==='due_date'?null:'')]));
export function remoteSnapshot(t,columns,users){
 if(t.deleted||t.archived)throw new SyncConflict('remote_removed');
 const entries=Object.entries(columns).filter(([,id])=>id===t.columnId);
 if(entries.length!==1)throw new SyncConflict('remote_outside_scope');
 if(!Array.isArray(t.assigned)||t.assigned.length!==1)throw new SyncConflict('single_assignee_required',['assignee_id']);
 const binding=users.find(u=>u.remote_user===t.assigned[0]);if(!binding)throw new SyncConflict('unbound_assignee',['assignee_id']);
 const status=t.completed?'done':entries[0][0];
 let due=null;if(t.deadline?.deadline!=null){
  const n=t.deadline.deadline;if(typeof n!=='number'||!Number.isFinite(n)||!Number.isFinite(new Date(n).getTime()))throw new SyncConflict('invalid_deadline',['due_date']);
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(n));
  due=['year','month','day'].map(k=>parts.find(p=>p.type===k)?.value).join('-');
 }
 if(t.description!=null&&typeof t.description!=='string')throw new SyncConflict('invalid_description');
 const title=t.title,description=decodeText(t.description||'');
 if(typeof title!=='string'||!title.trim()||title.length>240||description.length>10000)throw new SyncConflict('unsupported_text_size');
 return {title,description,assignee_id:binding.employee_id,status,due_date:due};
}
export function mergeTask(local,remote,link){
 const baseL=link.base_local,baseR=link.base_remote;
 if(!baseL||!baseR)throw new SyncConflict('baseline_missing');
 const resolution=link.resolution;
 if(resolution){
  if(resolution.version!==local.version||!mergeEqual(resolution.remote,remote))throw new SyncConflict('resolution_stale');
  if(resolution.choice==='local')return {desired:localSnapshot(local),push:SYNC_FIELDS.filter(k=>!equivalent(k,local[k],remote[k])),pull:[]};
  if(resolution.choice==='remote')return {desired:{...remote,status:remote.status==='pending'&&local.status==='accepted'?'accepted':remote.status},push:[],pull:SYNC_FIELDS.filter(k=>!equivalent(k,local[k],remote[k]))};
  throw new SyncConflict('invalid_resolution');
 }
 const desired=localSnapshot(local),push=[],pull=[],conflicts=[];
 for(const key of SYNC_FIELDS){
  const l=desired[key],r=remote[key],lc=!mergeEqual(l,baseL[key]),rc=!mergeEqual(r,baseR[key]);
  if(lc&&rc&&!equivalent(key,l,r)){conflicts.push(key);continue;}
  if(lc&&!equivalent(key,l,r))push.push(key);
  if(rc&&!lc&&!equivalent(key,l,r)){desired[key]=r;pull.push(key);}
 }
 if(conflicts.length)throw new SyncConflict('both_sides_changed',conflicts);
 return {desired,push,pull};
}
function equivalent(key,l,r){return mergeEqual(l,r)||key==='status'&&l==='accepted'&&r==='pending';}
export function remotePatch(snapshot,fields,columns,users,currentRemote){
 const patch={};
 for(const key of fields){
  if(key==='title')patch.title=snapshot.title;
  if(key==='description')patch.description=escapeText(snapshot.description);
  if(key==='assignee_id'){const binding=users.find(u=>u.employee_id===snapshot.assignee_id);if(!binding)throw new SyncConflict('unbound_assignee',[key]);patch.assigned=[binding.remote_user];}
  if(key==='status'){const status=snapshot.status==='accepted'?'pending':snapshot.status;if(!columns[status])throw new SyncConflict('status_unmapped',[key]);patch.columnId=columns[status];patch.completed=status==='done';}
  if(key==='due_date'){
   if(currentRemote?.deadline?.withTime)throw new SyncConflict('timed_deadline_requires_review',[key]);
   if(snapshot.due_date===null)patch.deadline={deleted:true};
   else if(!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.due_date)||!Number.isFinite(new Date(snapshot.due_date+'T12:00:00Z').getTime())||new Date(snapshot.due_date+'T12:00:00Z').toISOString().slice(0,10)!==snapshot.due_date)throw new SyncConflict('invalid_deadline',[key]);
   else patch.deadline={deadline:new Date(snapshot.due_date+'T12:00:00Z').getTime(),withTime:false};
  }
 }
 return patch;
}
export function assertIncomingStatus(task,desired){
 if(task.assignee_id!==desired.assignee_id){
  if(['done','cancelled'].includes(task.status)||desired.status!=='pending')throw new SyncConflict('reassignment_requires_pending',['assignee_id','status']);
  return;
 }
 if(task.status===desired.status)return;
 const allowed={pending:['cancelled'],accepted:['in_progress','cancelled'],in_progress:['review','cancelled'],review:['in_progress','done','cancelled'],done:[],cancelled:[]};
 if(!allowed[task.status]?.includes(desired.status))throw new SyncConflict(task.status==='pending'?'acceptance_required':'invalid_transition',['status']);
}
