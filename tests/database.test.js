import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db;
const ids={manager:'00000000-0000-4000-8000-000000000001',deputy:'00000000-0000-4000-8000-000000000002',employee:'00000000-0000-4000-8000-000000000003',other:'00000000-0000-4000-8000-000000000004'};
const call=async(role,action,data={})=>(await db.query('select public.dvfm_crm($1::uuid,$2,$3::jsonb) as value',[ids[role]||role,action,JSON.stringify(data)])).rows[0].value;
const bot=async(update,telegram,action,data)=>(await db.query('select public.dvfm_bot($1,$2,$3,$4::jsonb) as value',[update,telegram,action,JSON.stringify(data)])).rows[0].value;
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema storage;create table storage.objects(bucket_id text);alter table storage.objects enable row level security;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
 await db.exec(await readFile(new URL('../supabase/migrations/202611120001_crm.sql',import.meta.url),'utf8'));
 await db.exec('create table public.employees(id integer primary key,telegram_id bigint,full_name text,position text,role text,is_active boolean);');
 let i=0;for(const [role,id] of Object.entries(ids)){const telegram=900000001+i++;const actualRole=role==='other'?'employee':role;await db.query('insert into dvfm.employees(id,telegram_id,full_name,role) values($1,$2,$3,$4)',[id,telegram,`Fixture ${role}`,actualRole]);await db.query('insert into public.employees values($1,$2,$3,$4,$5,true)',[i,telegram,`Fixture ${role}`,'Fixture position',actualRole]);}
 await db.exec(await readFile(new URL('../supabase/migrations/202611120002_existing_employees.sql',import.meta.url),'utf8'));
});
after(async()=>{await db?.close();});
test('anon/authenticated cannot execute RPC or read private schema',async()=>{
 for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(db.query('select public.dvfm_crm($1,\'snapshot\')',[ids.manager]),/permission denied/);await assert.rejects(db.query('select * from dvfm.employees'),/permission denied/);await db.exec('reset role');}
});
test('employee self only, forged role and actor fields ignored, no IDOR',async()=>{
 await assert.rejects(call('employee','task.create',{title:'No',assignee_id:ids.other,role:'manager'}),/forbidden/);
 const t=await call('employee','task.create',{title:'Self',role:'manager',p_actor:ids.manager});assert.equal(t.assignee_id,ids.employee);
 await assert.rejects(call('other','task.detail',{id:t.id}),/forbidden/);
 assert.ok(!(await call('other','snapshot')).tasks.some(x=>x.id===t.id));
 await assert.rejects(call('employee','task.update',{id:t.id,version:1,status:'done',progress:100}),/invalid transition/);
});
test('manager/deputy assignment, acceptance, lifecycle, checkpoints, history and conflict',async()=>{
 const p=await call('deputy','project.create',{title:'Fixture project',owner_id:ids.employee});
 const t=await call('manager','task.create',{title:'Assigned',assignee_id:ids.employee,project_id:p.id});
 await assert.rejects(call('manager','task.accept',{id:t.id}),/forbidden/);
 const cp=await call('manager','checkpoint.create',{id:t.id,title:'Checkpoint'});
 let current=await call('employee','task.accept',{id:t.id});assert.equal(current.status,'accepted');
 await assert.rejects(call('employee','task.accept',{id:t.id}),/forbidden/);
 await assert.rejects(call('employee','task.update',{id:t.id,version:1,status:'in_progress',progress:10}),/version conflict/);
 current=await call('employee','task.update',{id:t.id,version:current.version,status:'in_progress',progress:50});
 await assert.rejects(call('employee','task.update',{id:t.id,version:current.version,status:'in_progress',progress:101}),/check constraint/);
 await call('employee','comment.create',{id:t.id,body:'Synthetic comment'});
 current=await call('employee','task.update',{id:t.id,version:current.version,status:'review',progress:90});
 await assert.rejects(call('employee','task.update',{id:t.id,version:current.version,status:'done',progress:100}),/invalid transition/);
 await assert.rejects(call('deputy','task.update',{id:t.id,version:current.version,status:'done',progress:100}),/open checkpoints/);
 await call('employee','checkpoint.toggle',{id:t.id,checkpoint_id:cp.id,done:true});
 current=await call('deputy','task.update',{id:t.id,version:current.version,status:'done',progress:50});assert.equal(current.progress,100);
 await assert.rejects(call('employee','checkpoint.toggle',{id:t.id,checkpoint_id:cp.id,done:false}),/forbidden/);
 const detail=await call('employee','task.detail',{id:t.id});assert.equal(detail.comments.length,1);assert.equal(detail.history.length,8);
});
test('private document owner policy also applies to manager',async()=>{
 const doc=await call('employee','document.reserve',{name:'fixture.pdf',mime:'application/pdf',size:100});
 assert.ok(doc.path.startsWith(ids.employee+'/'));
 for(const role of ['manager','deputy','other'])await assert.rejects(call(role,'document.get',{id:doc.id}),/forbidden/);
 await call('employee','document.complete',{id:doc.id});assert.ok((await call('employee','snapshot')).documents.some(d=>d.id===doc.id&&!d.path));
});
test('bot deduplicates tasks and resumes document reservations',async()=>{
 const t=await bot(101,900000003,'task.create',{title:'Bot fixture'});assert.ok(t.id);assert.deepEqual(await bot(101,900000003,'task.create',{title:'Bot fixture'}),{duplicate:true});
 const doc=await bot(102,900000003,'document.reserve',{name:'bot.txt',mime:'text/plain',size:1});assert.equal((await bot(102,900000003,'document.reserve',{})).id,doc.id);
});
test('outbox lease avoids concurrent claim and supports retry',async()=>{
 const jobs=(await db.query('select public.dvfm_outbox() as value')).rows[0].value;assert.ok(jobs.length);
 assert.deepEqual((await db.query('select public.dvfm_outbox() as value')).rows[0].value,[]);
 const job=jobs[0];await db.query('select public.dvfm_outbox($1,$2,true)',[job.id,job.lease_token]);assert.ok((await db.query('select sent_at from dvfm.outbox where id=$1',[job.id])).rows[0].sent_at);
});
test('revocation is immediate and unknown identity fails closed',async()=>{
 await db.query('update public.employees set is_active=false where telegram_id=$1',[900000004]);await assert.rejects(call('other','snapshot'),/forbidden/);
 assert.equal((await db.query('select public.dvfm_identity(999999999) as value')).rows[0].value,null);
});

test('restrictive storage fence defeats a legacy permissive read policy',async()=>{
 await db.exec("grant usage on schema storage to anon;grant select on storage.objects to anon;create policy legacy_open on storage.objects for select to anon using(true);insert into storage.objects values('dvfm-private'),('legacy-public');set role anon;");
 try{assert.deepEqual((await db.query('select bucket_id from storage.objects')).rows,[{bucket_id:'legacy-public'}]);}finally{await db.exec('reset role');}
});
test('project visibility and creation cannot be forged by employees',async()=>{
 await assert.rejects(call('employee','project.create',{title:'No',role:'manager'}),/forbidden/);
 const p=await call('manager','project.create',{title:'Management only'});
 await assert.rejects(call('employee','task.create',{title:'Hidden project',project_id:p.id}),/forbidden/);
});

test('legacy identity preserves source ID and position while CRM uses stable UUID',async()=>{
 const identity=(await db.query('select public.dvfm_identity(900000003) as value')).rows[0].value;
 assert.equal(identity.id,ids.employee);assert.equal(identity.legacy_id,3);assert.equal(identity.position,'Fixture position');
});
test('legacy demotion and disabled recipients override stale internal mapping',async()=>{
 await db.query("update public.employees set role='employee',full_name='Renamed fixture' where telegram_id=900000002");
 assert.equal((await call('deputy','snapshot')).employee.role,'employee');
 await assert.rejects(call('deputy','project.create',{title:'Denied after demotion'}),/forbidden/);
 assert.equal((await call('deputy','snapshot')).employee.full_name,'Renamed fixture');
 await db.query("update public.employees set role='deputy' where telegram_id=900000002");
 await assert.rejects(call('manager','task.create',{title:'Inactive recipient',assignee_id:ids.other}),/inactive assignee/);
 await db.query("update dvfm.employee_ids set role='manager',active=true where id=$1",[ids.employee]);
 assert.equal((await call('employee','snapshot')).employee.role,'employee');
 await assert.rejects(call('employee','project.create',{title:'No cached promotion'}),/forbidden/);
});
test('existing source additions get mappings; deletions and duplicate IDs fail closed',async()=>{
 await db.exec("insert into public.employees values(5,900000005,'New fixture','Fixture','employee',true)");
 const identity=(await db.query('select public.dvfm_identity(900000005) as value')).rows[0].value;assert.ok(identity.id);assert.equal(identity.legacy_id,5);
 await db.exec("insert into public.employees values(6,900000005,'Duplicate fixture','Fixture','manager',true)");
 assert.equal((await db.query('select public.dvfm_identity(900000005) as value')).rows[0].value,null);
 await assert.rejects(call(identity.id,'snapshot'),/forbidden/);
 await db.exec('delete from public.employees where id in(5,6)');await assert.rejects(call(identity.id,'snapshot'),/forbidden/);
});
test('unsupported legacy role denies access without implicit admin promotion',async()=>{
 await db.exec("insert into public.employees values(7,900000007,'Unsupported fixture','Fixture','admin',true)");
 assert.equal((await db.query('select public.dvfm_identity(900000007) as value')).rows[0].value,null);
});
