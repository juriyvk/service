import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
let db;
const key='Bearer synthetic_worker_key_for_tests_1234567890';
const call=async auth=>(await db.query('select public.dvfm_staging_configure_worker($1) as value',[auth])).rows[0].value;
before(async()=>{
 db=new PGlite();
 // Only the platform extensions are stubbed; the actual configurator runs in PostgreSQL.
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema dvfm;create table dvfm.outbox(id bigint);
 create schema vault;create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,secret text);
 create view vault.decrypted_secrets as select id,name,secret as decrypted_secret from vault.secrets;
 create function vault.create_secret(value text,secret_name text,description text) returns uuid language sql as 'insert into vault.secrets(name,secret) values(secret_name,value) returning id';
 create function vault.update_secret(secret_id uuid,value text) returns void language sql as 'update vault.secrets set secret=value where id=secret_id';
 create schema cron;create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,command text);
 create function cron.schedule(name text,cron_expr text,sql_command text) returns bigint language sql as 'insert into cron.job(jobname,schedule,command) values(name,cron_expr,sql_command) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid';`);
 const sql=(await readFile(new URL('../docs/staging-install-worker.sql',import.meta.url),'utf8')).replace(/^create extension[^;]*;$/gm,'');await db.exec(sql);
});
after(async()=>{await db?.close();});
test('scheduler credentials stay out of stored cron command and returned status',async()=>{
 const result=await call(key);assert.equal(result.configured,true);assert.equal(result.auth_storage,'vault');
 const job=(await db.query('select * from cron.job')).rows[0];assert.equal(job.schedule,'* * * * *');assert.ok(job.command.includes('https://wepogbvijpvyvyfzxzeo.supabase.co/functions/v1/telegram-webhook?worker=1'));assert.ok(job.command.includes('vault.decrypted_secrets'));assert.ok(!job.command.includes(key));assert.ok(!JSON.stringify(result).includes(key));
});
test('reconfiguration rotates vault secret without duplicating the cron job',async()=>{
 const newKey='Bearer '+'s'.repeat(256);await call(newKey);assert.equal((await db.query('select count(*)::int as n from cron.job')).rows[0].n,1);assert.equal((await db.query('select count(*)::int as n from vault.secrets')).rows[0].n,1);assert.equal((await db.query('select decrypted_secret from vault.decrypted_secrets')).rows[0].decrypted_secret,newKey);
});
test('client roles cannot configure scheduler; invalid formats do not change secret',async()=>{
 for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);try{await assert.rejects(call(key),/permission denied/);}finally{await db.exec('reset role');}}
 for(const value of [null,'Bearer bad','Bearer '+'x'.repeat(257),'bearer invalid_format_123456789012345678901234567890'])await assert.rejects(call(value),/Invalid worker Authorization format/);
 assert.equal((await db.query('select count(*)::int as n from cron.job')).rows[0].n,1);
});

test('scheduler refuses to store credentials if Vault decrypted view is exposed',async()=>{
 await db.exec('grant usage on schema vault to anon;grant select on vault.decrypted_secrets to anon');
 try{await assert.rejects(call(key),/Vault decrypted view must not be readable/);}finally{await db.exec('revoke select on vault.decrypted_secrets from anon');}
});
