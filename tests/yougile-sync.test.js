import {test,before,after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {syncYougile} from '../supabase/functions/_shared/yougile-sync.js';
let db,manager,employee,project,native,keys,sequence,requests,loseResponse,editDuringWrite;
const id=n=>'40000000-0000-4000-8000-'+String(n).padStart(12,'0');
const ids={project:id(1),board:id(2),user:id(3),pending:id(4),in_progress:id(5),review:id(6),done:id(7)};
const settings={projectId:ids.project,boardId:ids.board,apiKey:'synthetic-key'};
const rpc=async(name,args)=>(await db.query('select public.dvfm_yg($1,$2,$3) as value',[args.p_actor,args.p_action,JSON.stringify(args.p_data)])).rows[0].value;
const admin=(action,data={})=>rpc('dvfm_yg',{p_actor:manager.id,p_action:action,p_data:data});
const crm=async(actor,action,data={})=>(await db.query('select public.dvfm_crm($1,$2,$3) as value',[actor,action,JSON.stringify(data)])).rows[0].value;
const reply=data=>new Response(JSON.stringify(data));
const transport=async(url,options)=>{
 const u=new URL(url),path=u.pathname.replace('/api-v2','');requests.push({path,method:options.method});
 if(path.startsWith('/projects/'))return reply({id:ids.project,title:'Fixture project',users:{[ids.user]:'worker'}});
 if(path.startsWith('/boards/'))return reply({id:ids.board,projectId:ids.project,title:'Fixture board'});
 if(path==='/columns')return reply({paging:{next:false},content:['pending','in_progress','review','done'].map(key=>({id:ids[key],boardId:ids.board,title:key}))});
 if(path==='/task-list'){const all=[...native.values()].filter(t=>t.columnId===u.searchParams.get('columnId'));const start=Number(u.searchParams.get('offset'));return reply({paging:{next:all.length>start+5},content:all.slice(start,start+5)});}
 if(path==='/tasks'&&options.method==='POST'){
  const data=JSON.parse(options.body);let remoteId=keys.get(data.idempotencyKey);
  if(!remoteId){remoteId=id(sequence++);native.set(remoteId,{id:remoteId,...data});keys.set(data.idempotencyKey,remoteId);}
  if(loseResponse){loseResponse=false;throw new Error('simulated connection loss after creation');}
  return reply({id:remoteId});
 }
 const remoteId=path.split('/').at(-1),object=native.get(remoteId);
 if(!object)return new Response('{}',{status:404});
 if(options.method==='PUT'){const data=JSON.parse(options.body);if(data.deadline?.deleted)data.deadline=null;Object.assign(object,data);if(editDuringWrite){object.description='Concurrent external description';editDuringWrite=false;}return reply({id:remoteId});}
 return reply(object);
};
const run=()=>syncYougile(settings,rpc,transport);
before(async()=>{
 db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;create schema storage;create table storage.objects(bucket_id text);alter table storage.objects enable row level security;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
 await db.exec(await readFile(new URL('../docs/staging-setup.sql',import.meta.url),'utf8'));await db.exec(await readFile(new URL('../supabase/migrations/202611260001_yougile_sync.sql',import.meta.url),'utf8'));
 await db.exec("insert into public.employees(telegram_id,full_name,role,is_active) values(960000001,'Synthetic manager','manager',true),(960000002,'Synthetic employee','employee',true)");
 manager=(await db.query('select public.dvfm_identity(960000001) as v')).rows[0].v;employee=(await db.query('select public.dvfm_identity(960000002) as v')).rows[0].v;
 project=await crm(manager.id,'project.create',{title:'Fixture CRM project'});
 await admin('configure',{project_id:project.id,remote_project:ids.project,board_id:ids.board,columns:Object.fromEntries(['pending','in_progress','review','done'].map(k=>[k,ids[k]])),enabled:true,import_new:true});
 await admin('bind',{employee_id:employee.id,remote_user:ids.user});
});
beforeEach(async()=>{native=new Map();keys=new Map();sequence=100;requests=[];loseResponse=false;editDuringWrite=false;await db.exec('truncate dvfm.yg_log,dvfm.yg_dirty,dvfm.yg_links,dvfm.outbox,dvfm.comments,dvfm.history,dvfm.checkpoints,dvfm.tasks cascade;update dvfm.yg_config set lease=null,lease_until=null,rate_minute=null,rate_count=0,scan_column=0,scan_offset=0,watch_cursor=null,scan_error=null');});
after(async()=>{await db?.close();});
const make=()=>crm(manager.id,'task.create',{title:'Synthetic task',project_id:project.id,assignee_id:employee.id});
const next=()=>db.exec('update dvfm.yg_config set rate_minute=null,rate_count=0');
const linked=async task=>(await db.query('select * from dvfm.yg_links where task_id=$1',[task.id])).rows[0];
test('bidirectional run creates once, pulls changes, and acknowledged state does not echo',async()=>{
 let task=await make();await run();assert.equal(native.size,1);const link=await linked(task);assert.ok(link.remote_id);assert.equal((await admin('status')).pending,0);
 native.get(link.remote_id).title='Edited in YouGile';await next();await run();assert.equal((await crm(manager.id,'task.detail',{id:task.id})).task.title,'Edited in YouGile');
 task=await crm(employee.id,'task.accept',{id:task.id});task=await crm(employee.id,'task.update',{id:task.id,version:task.version,status:'in_progress',progress:40});
 await next();await run();assert.equal(native.get(link.remote_id).columnId,ids.in_progress);
 requests=[];await next();await run();assert.ok(!requests.some(r=>r.method==='PUT'||r.method==='POST'));assert.equal(native.size,1);
});
test('remote-only task imports idempotently and remains pending',async()=>{
 native.set(id(150),{id:id(150),title:'Native fixture',description:'Fixture',assigned:[ids.user],columnId:ids.pending,completed:false});
 await run();await next();await run();assert.equal((await db.query('select count(*)::int n from dvfm.tasks')).rows[0].n,1);
 const row=(await db.query('select * from dvfm.tasks')).rows[0];assert.equal(row.status,'pending');assert.equal(row.assignee_id,employee.id);assert.equal(row.accepted_at,null);
});
test('lost create response reuses idempotency key and does not import a duplicate CRM task',async()=>{
 const task=await make();loseResponse=true;const first=await run();assert.equal(first.retried,1);assert.equal(native.size,1);assert.equal((await db.query('select count(*)::int n from dvfm.tasks')).rows[0].n,1);
 await admin('retry.reset',{task_id:task.id});await next();await run();assert.equal(native.size,1);assert.ok((await linked(task)).remote_id);assert.equal((await db.query('select count(*)::int n from dvfm.tasks')).rows[0].n,1);
});
test('concurrent edits create a conflict; explicit resolution checks current versions',async()=>{
 let task=await make();await run();const link=await linked(task);task=await crm(employee.id,'task.accept',{id:task.id});
 // Progression changed locally; native progression independently changed to review.
 native.get(link.remote_id).columnId=ids.review;await next();await run();const issue=(await admin('status')).issues[0];assert.equal(issue.conflict.reason,'both_sides_changed');
 await admin('resolve',{task_id:task.id,conflict_id:issue.conflict.id,version:issue.local_version,choice:'local'});await next();await run();
 assert.equal(native.get(link.remote_id).columnId,ids.pending);assert.equal((await linked(task)).conflict,null);
});
test('foreign-column movement is detected by linked-task polling, even outside scan columns',async()=>{
 const task=await make();await run();const link=await linked(task);native.get(link.remote_id).columnId=id(999);await next();await run();assert.equal((await linked(task)).conflict.reason,'remote_outside_scope');
});
test('missing acceptance never becomes fabricated from an external status',async()=>{
 const task=await make();await run();const link=await linked(task);native.get(link.remote_id).columnId=ids.in_progress;await next();await run();
 assert.equal((await linked(task)).conflict.reason,'acceptance_required');const current=(await crm(manager.id,'task.detail',{id:task.id})).task;assert.equal(current.status,'pending');assert.equal(current.accepted_at,null);
});
test('request budget stops cleanly and releases the lease for the next run',async()=>{
 await make();await db.exec("update dvfm.yg_config set rate_minute=date_trunc('minute',now()),rate_count=30");const result=await run();assert.equal(result.limited,true);assert.equal(native.size,0);
 assert.equal((await db.query('select lease from dvfm.yg_config')).rows[0].lease,null);
});

test('a different field edited during PUT is not acknowledged over an older incoming snapshot',async()=>{
 let task=await make();await run();const link=await linked(task);
 task=await crm(employee.id,'task.accept',{id:task.id});
 task=await crm(employee.id,'task.update',{id:task.id,version:task.version,status:'in_progress',progress:20});
 native.get(link.remote_id).description='First external description';editDuringWrite=true;
 await next();await run();
 const updated=await linked(task);assert.equal(updated.conflict.reason,'remote_changed_after_write');
 assert.equal(updated.conflict.remote.description,'Concurrent external description');
 assert.notEqual((await crm(manager.id,'task.detail',{id:task.id})).task.description,'First external description');
 await admin('retry.reset',{task_id:task.id});await next();await run();
 assert.equal((await crm(manager.id,'task.detail',{id:task.id})).task.description,'Concurrent external description');
});
