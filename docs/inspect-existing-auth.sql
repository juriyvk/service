-- Read-only. Run in Supabase SQL Editor; returns schema and counts, never staff records.
select column_name,data_type,is_nullable from information_schema.columns
where table_schema='public' and table_name='employees' order by ordinal_position;
select role::text as role,count(*) as total,count(*) filter(where is_active) as active
from public.employees group by role::text order by role::text;
select count(*) as duplicate_telegram_groups from (
 select telegram_id from public.employees where telegram_id is not null group by telegram_id having count(*)>1
) duplicate_groups;
select relrowsecurity as rls_enabled from pg_class where oid='public.employees'::regclass;
select policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename='employees';
select grantee,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name='employees' and grantee in ('anon','authenticated');
