import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db,sql;
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;create schema storage;create table storage.objects(bucket_id text);alter table storage.objects enable row level security;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');sql=await readFile(new URL('../docs/staging-setup.sql',import.meta.url),'utf8');});
after(async()=>{await db?.close();});
test('complete staging bundle applies atomically, passes smoke and leaves no fixtures',async()=>{
 const results=await db.exec(sql);assert.deepEqual(results.at(-1).rows,[{status:'staging_schema_ready',employees:0,tasks:0,queued_notifications:0}]);
 assert.equal((await db.query('select count(*)::int as n from dvfm.documents')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int as n from dvfm.employee_ids')).rows[0].n,0);
 assert.deepEqual((await db.query('select version from supabase_migrations.schema_migrations order by version')).rows.map(r=>r.version),['202611120001','202611120002']);
});
test('bundle refuses to reinstall over an existing project',async()=>{
 await assert.rejects(db.exec(sql),/CRM schema already exists/);await db.exec('rollback');
 assert.equal((await db.query('select count(*)::int as n from supabase_migrations.schema_migrations')).rows[0].n,2);
});

test('manual registration refuses an unreplaced placeholder without adding staff',async()=>{
 const query=await readFile(new URL('../docs/staging-register-self.sql',import.meta.url),'utf8');
 await assert.rejects(db.exec(query),/Replace the placeholder/);await db.exec('rollback');
 assert.equal((await db.query('select count(*)::int as n from public.employees')).rows[0].n,0);
});
test('manual access template works with synthetic ID and refuses a second grant',async()=>{
 const query=(await readFile(new URL('../docs/staging-register-self.sql',import.meta.url),'utf8')).replaceAll('REPLACE_WITH_YOUR_ID','930000001');
 const result=await db.exec(query);assert.equal(result.at(-1).rows[0].status,'manual_staging_access_ready');
 const identity=(await db.query('select public.dvfm_identity(930000001) as value')).rows[0].value;assert.equal(identity.role,'manager');assert.equal(identity.full_name,'Тестовый руководитель');
 await assert.rejects(db.exec(query),/Employees already exist/);await db.exec('rollback');
 assert.equal((await db.query('select count(*)::int as n from public.employees')).rows[0].n,1);
});
