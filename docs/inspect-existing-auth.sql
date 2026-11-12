-- Read-only: one statement and one result table. Does not return employee records.
with report as (
 select 1 as sort_order, 'columns' as section,
 coalesce(jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'nullable',is_nullable) order by ordinal_position),'[]'::jsonb) as details
 from information_schema.columns where table_schema='public' and table_name='employees'
 union all
 select 2,'roles',coalesce(jsonb_agg(to_jsonb(counts) order by counts.role),'[]'::jsonb)
 from (select role::text as role,count(*) as total,count(*) filter(where is_active) as active
       from public.employees group by role::text) counts
 union all
 select 3,'duplicate_telegram_groups',jsonb_build_object('count',count(*))
 from (select telegram_id from public.employees where telegram_id is not null
       group by telegram_id having count(*)>1) duplicates
 union all
 select 4,'rls',jsonb_build_object('enabled',relrowsecurity,'forced',relforcerowsecurity)
 from pg_class where oid='public.employees'::regclass
 union all
 select 5,'policies',coalesce(jsonb_agg(jsonb_build_object('name',policyname,'permissive',permissive,
 'roles',roles,'command',cmd,'using',qual,'check',with_check) order by policyname),'[]'::jsonb)
 from pg_policies where schemaname='public' and tablename='employees'
 union all
 select 6,'table_grants',coalesce(jsonb_agg(jsonb_build_object('role',grantee,'privilege',privilege_type)
 order by grantee,privilege_type),'[]'::jsonb)
 from information_schema.table_privileges where table_schema='public' and table_name='employees'
 and grantee in ('PUBLIC','anon','authenticated')
 union all
 select 7,'column_grants',coalesce(jsonb_agg(jsonb_build_object('role',grantee,'column',column_name,
 'privilege',privilege_type) order by grantee,column_name,privilege_type),'[]'::jsonb)
 from information_schema.column_privileges where table_schema='public' and table_name='employees'
 and grantee in ('PUBLIC','anon','authenticated')
)
select section,details from report order by sort_order;
