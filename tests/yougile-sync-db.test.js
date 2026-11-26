import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
let db,manager,employee,project,lease,task;
const ids={remoteProject:'20000000-0000-4000-8000-000000000001',board:'20000000-0000-4000-8000-000000000002',user:'20000000-0000-4000-8000-000000000003',pending:'20000000-0000-4000-8000-000000000004',work:'20000000-0000-4000-8000-000000000005',review:'20000000-0000-4000-8000-000000000006',done:'20000000-0000-4000-8000-000000000007',remoteTask:'20000000-0000-4000-8000-000000000008'};
const rpc=async(actor,action,data={})=>(await db.query('select public.dvfm_yg($1,$2,$3) as value',[actor,action,JSON.stringify(data)])).rows[0].value;
const worker=(action,data={})=>rpc(null,action,{lease,...data});
const crm=async(actor,action,data={})=>(await db.query('select public.dvfm_crm($1,$2,$3) as value',[actor,action,JSON.stringify(data)])).rows[0].value;
const snapshot=t=>({title:t.title,description:t.description,assignee_id:t.assignee_id,status:t.status,due_date:t.due_date});
const config=()=>({project_id:project.id,remote_project:ids.remoteProject,board_id:ids.board,columns:{pending:ids.pending,in_progress:ids.work,review:ids.review,done:ids.done},enabled:true,import_new:true});
before(async()=>{
 db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;create schema storage;create table storage.objects(bucket_id text);alter table storage.objects enable row level security;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
 await db.exec(await readFile(new URL('../docs/staging-setup.sql',import.meta.url),'utf8'));
 await db.exec("insert into public.employees(telegram_id,full_name,role,is_active) values(950000001,'Synthetic manager','manager',true),(950000002,'Synthetic employee','employee',true)");
 const identity=async id=>(await db.query('select public.dvfm_identity($1) as value',[id])).rows[0].value;
 manager=await identity(950000001);employee=await identity(950000002);project=await crm(manager.id,'project.create',{title:'Synthetic sync project'});
 await db.exec(await readFile(new URL('../docs/staging-upgrade-yougile.sql',import.meta.url),'utf8'));
});
after(async()=>{await db?.close();});
test('additive Dashboard upgrade preserves existing staff and starts disabled',async()=>{
 assert.equal((await db.query('select count(*)::int n from public.employees')).rows[0].n,2);
 assert.equal((await db.query('select count(*)::int n from dvfm.projects')).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from dvfm.yg_config')).rows[0].n,0);
 assert.equal((await db.query("select count(*)::int n from supabase_migrations.schema_migrations where version='202611260001'")).rows[0].n,1);
});
test('sync RPC is service-only; no browser role can configure or read sync tables',async()=>{
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(rpc(manager.id,'status'),/permission denied/);await assert.rejects(db.query('select * from dvfm.yg_config'),/permission denied/);}finally{await db.exec('reset role');}}
 await assert.rejects(rpc(employee.id,'configure',config()),/forbidden/);
});
test('configuration is explicit; binding and single worker lease preserve scope',async()=>{
 assert.equal((await rpc(null,'run.claim')).enabled,false);
 await rpc(manager.id,'configure',config());await rpc(manager.id,'bind',{employee_id:employee.id,remote_user:ids.user});
 const claim=await rpc(null,'run.claim');lease=claim.lease;assert.ok(lease);assert.equal((await rpc(null,'run.claim')).busy,true);
 await assert.rejects(rpc(manager.id,'configure',config()),/worker busy/);
 for(let i=0;i<30;i++)assert.equal(await worker('permit'),true);assert.equal(await worker('permit'),false);
});
test('local writes enqueue durable work; incoming application requires acceptance',async()=>{
 task=await crm(manager.id,'task.create',{title:'Synthetic outbound',project_id:project.id,assignee_id:employee.id});
 assert.equal((await worker('work')).length,1);
 const desired={...snapshot(task),status:'in_progress'};
 await assert.rejects(worker('pull',{task_id:task.id,remote_id:ids.remoteTask,version:task.version,desired,remote:desired}),/acceptance/);
 task=await crm(employee.id,'task.accept',{id:task.id});const version=task.version;
 const result=await worker('pull',{task_id:task.id,remote_id:ids.remoteTask,version,desired:{...snapshot(task),status:'in_progress'},remote:desired});task=result.task;
 assert.equal(task.status,'in_progress');assert.equal((await worker('work')).length,0);assert.ok(task.accepted_at);
});
test('completion cannot bypass checkpoints and incoming history is durable',async()=>{
 const cp=await crm(manager.id,'checkpoint.create',{id:task.id,title:'Synthetic checkpoint'});
 let result=await worker('pull',{task_id:task.id,remote_id:ids.remoteTask,version:task.version,desired:{...snapshot(task),status:'review'},remote:{...snapshot(task),status:'review'}});task=result.task;
 await assert.rejects(worker('pull',{task_id:task.id,remote_id:ids.remoteTask,version:task.version,desired:{...snapshot(task),status:'done'},remote:{...snapshot(task),status:'done'}}),/open checkpoints/);
 await crm(employee.id,'checkpoint.toggle',{id:task.id,checkpoint_id:cp.id,done:true});
 result=await worker('pull',{task_id:task.id,remote_id:ids.remoteTask,version:task.version,desired:{...snapshot(task),status:'done'},remote:{...snapshot(task),status:'done'}});task=result.task;assert.equal(task.progress,100);
 await assert.rejects(worker('pull',{task_id:task.id,remote_id:ids.remoteTask,version:task.version,desired:{...snapshot(task),status:'in_progress'},remote:{...snapshot(task),status:'in_progress'}}),/terminal/);
 assert.ok((await crm(manager.id,'task.detail',{id:task.id})).history.some(h=>h.action==='yougile.pull'));
});
test('ack for an older local version preserves newer queued work',async()=>{
 const t=await crm(manager.id,'task.create',{title:'Synthetic race',project_id:project.id,assignee_id:employee.id});
 const accepted=await crm(employee.id,'task.accept',{id:t.id});
 await worker('ack',{task_id:t.id,remote_id:'20000000-0000-4000-8000-000000000009',version:t.version,local:snapshot(t),remote:snapshot(t)});
 assert.ok((await worker('work')).some(x=>x.task.id===accepted.id));
});
test('import is idempotent, pending, and does not echo back into outbound queue',async()=>{
 const remote={title:'Synthetic inbound',description:'Fixture',assignee_id:employee.id,status:'pending',due_date:null};const rid='20000000-0000-4000-8000-000000000010';
 const result=await worker('import',{remote_id:rid,remote});assert.equal(result.task.status,'pending');assert.equal((await worker('import',{remote_id:rid,remote})).existing,true);
 assert.ok(!(await worker('work')).some(x=>x.task.id===result.task.id));assert.equal((await worker('lookup',{remote_id:rid})).task.id,result.task.id);
});
test('operator retry rechecks a repaired conflict without choosing a winning side',async()=>{
 await worker('conflict',{task_id:task.id,reason:'unbound_assignee',remote:null});
 await rpc(manager.id,'retry.reset',{task_id:task.id});
 const item=(await worker('work')).find(x=>x.task.id===task.id);
 assert.equal(item.link.conflict,null);assert.equal(item.link.resolution,null);
 assert.ok(item.link.base_local);assert.ok(item.link.base_remote);
});
test('stale conflicts require fresh versions and revocation stops worker',async()=>{
 await worker('conflict',{task_id:task.id,reason:'both_sides_changed',remote:snapshot(task),fields:['title']});
 const status=await rpc(manager.id,'status');const issue=status.issues.find(i=>i.task_id===task.id);
 await assert.rejects(rpc(manager.id,'resolve',{task_id:task.id,conflict_id:issue.conflict.id,choice:'local'}),/stale conflict/);
 await rpc(manager.id,'resolve',{task_id:task.id,conflict_id:issue.conflict.id,version:task.version,choice:'local'});
 assert.ok((await worker('work')).some(x=>x.task.id===task.id&&x.link.resolution));
 await db.exec("update public.employees set is_active=false where telegram_id=950000001");
 await assert.rejects(worker('permit'),/forbidden/);
});
