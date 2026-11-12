import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db;
const legacyManager='10000000-0000-4000-8000-000000000001';
const legacyDeputy='10000000-0000-4000-8000-000000000002';
const identity=async telegram=>(await db.query('select public.dvfm_identity($1) as value',[telegram])).rows[0].value;
const call=async(actor,action,data={})=>(await db.query('select public.dvfm_crm($1,$2,$3) as value',[actor,action,JSON.stringify(data)])).rows[0].value;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema storage;create table storage.objects(bucket_id text);alter table storage.objects enable row level security;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create type public.fixture_role as enum('manager','deputy','employee');
 create table public.employees(id uuid primary key,telegram_id bigint unique not null,full_name text not null,position text,role public.fixture_role not null,is_active boolean not null);
 alter table public.employees enable row level security;revoke all on public.employees from public,anon,authenticated;`);
 for(const [id,telegram,role] of [[legacyManager,910000001,'manager'],[legacyDeputy,910000002,'deputy']])await db.query('insert into public.employees values($1,$2,$3,$4,$5,true)',[id,telegram,`Synthetic ${role}`,'Fixture position',role]);
 for(const migration of ['202611120001_crm.sql','202611120002_existing_employees.sql'])await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`,import.meta.url),'utf8'));
});
after(async()=>{await db?.close();});
test('UUID legacy IDs and enum roles survive both migrations unchanged',async()=>{
 const manager=await identity(910000001),deputy=await identity(910000002);
 assert.equal(manager.legacy_id,legacyManager);assert.equal(deputy.legacy_id,legacyDeputy);
 assert.equal(manager.role,'manager');assert.equal(deputy.role,'deputy');
 assert.notEqual(manager.id,legacyManager);
 assert.deepEqual((await db.query('select id from public.employees order by id')).rows.map(r=>r.id),[legacyManager,legacyDeputy]);
 const task=await call(manager.id,'task.create',{title:'Synthetic UUID assignment',assignee_id:deputy.id});
 assert.equal((await call(deputy.id,'task.accept',{id:task.id})).status,'accepted');
});
test('server-only RPC reads existing UUID registry despite no browser grants and RLS',async()=>{
 await db.exec('set role service_role');
 try{const employee=await identity(910000001);assert.equal(employee.legacy_id,legacyManager);assert.equal((await call(employee.id,'snapshot')).employee.role,'manager');}finally{await db.exec('reset role');}
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  try{await assert.rejects(db.query('select * from public.employees'),/permission denied/);await assert.rejects(identity(910000001),/permission denied/);}finally{await db.exec('reset role');}
 }
});
test('single-result inspection reports all sections without employee records',async()=>{
 const {rows}=await db.query(await readFile(new URL('../docs/inspect-existing-auth.sql',import.meta.url),'utf8'));
 assert.equal(rows.length,7);assert.equal(rows.find(r=>r.section==='rls').details.enabled,true);
 assert.deepEqual(rows.find(r=>r.section==='policies').details,[]);
 assert.deepEqual(rows.find(r=>r.section==='table_grants').details,[]);
 assert.ok(rows.find(r=>r.section==='columns').details.some(c=>c.name==='id'&&c.type==='uuid'));
 assert.ok(!JSON.stringify(rows).includes('Synthetic'));
});
