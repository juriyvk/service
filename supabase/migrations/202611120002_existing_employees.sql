-- Keep public.employees authoritative; never rewrite legacy records or IDs.
-- Requires the columns used by the existing deployed telegram-auth function.
begin;
do $$ begin
 if to_regclass('public.employees') is null then
  raise exception 'Existing public.employees is required; inspect the deployed auth schema before migration';
 end if;
 if exists(select 1 from public.employees where telegram_id is not null group by telegram_id having count(*)>1) then
  raise exception 'Duplicate Telegram IDs in existing employees; resolve administratively before migration';
 end if;
 if exists(select 1 from public.employees where is_active and role::text not in ('manager','deputy','employee')) then
  raise exception 'Unsupported active legacy role; review role mapping explicitly before migration';
 end if;
end $$;
-- Stable internal UUIDs keep CRM foreign keys independent of the legacy ID type.
-- The old metadata columns remain for migration compatibility; they grant no access.
alter table dvfm.employees rename to employee_ids;
insert into dvfm.employee_ids(telegram_id,full_name,role,active)
 select telegram_id,full_name::text,role::text,is_active
 from public.employees where role::text in ('manager','deputy','employee') and telegram_id>0
 on conflict(telegram_id) do nothing;
create view dvfm.employees with (security_barrier=true) as
 select mapping.id, source.telegram_id, source.full_name::text as full_name,
 source.role::text as role,
 (source.is_active and source.role::text in ('manager','deputy','employee')) as active,
 to_jsonb(source.id) as legacy_id, source.position::text as position
 from dvfm.employee_ids mapping join (
  select legacy.*, count(*) over(partition by telegram_id) as dvfm_duplicate_count
  from public.employees legacy
 ) source on source.telegram_id=mapping.telegram_id
 where source.dvfm_duplicate_count=1;
revoke all on dvfm.employees from public,anon,authenticated;
create or replace function public.dvfm_identity(p_telegram_id bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,dvfm as $$
declare source record; result jsonb; begin
 -- Fail closed if duplicate Telegram IDs appear after the migration.
 if (select count(*) from public.employees where telegram_id=p_telegram_id)<>1 then return null; end if;
 select full_name::text as full_name,role::text as role,is_active into source
 from public.employees where telegram_id=p_telegram_id for share;
 if not found or not source.is_active or source.role not in ('manager','deputy','employee') then return null; end if;
 -- Existing staff added administratively become available on first verified login.
 -- This creates only an internal mapping, never a new public employee or a role.
 insert into dvfm.employee_ids(telegram_id,full_name,role,active)
 values(p_telegram_id,source.full_name,source.role,true) on conflict(telegram_id) do nothing;
 select jsonb_build_object('id',id,'legacy_id',legacy_id,'full_name',full_name,'position',position,'role',role)
 into result from dvfm.employees where telegram_id=p_telegram_id and active;
 return result;
end $$;
-- Recompile PL/pgSQL declarations against the authoritative view rather than the
-- renamed mapping table. Existing SQL authorization, recipient checks and outbox
-- queries all resolve dvfm.employees through the same source on each invocation.
do $$ begin
 execute replace(pg_get_functiondef('public.dvfm_crm(uuid,text,jsonb)'::regprocedure),
 'select * into e from dvfm.employees where id=p_actor and active for share;',
 'perform 1 from public.employees legacy join dvfm.employee_ids mapping on mapping.telegram_id=legacy.telegram_id where mapping.id=p_actor for share of legacy;
 select * into e from dvfm.employees where id=p_actor and active;');
 execute replace(pg_get_functiondef('public.dvfm_bot(bigint,bigint,text,jsonb)'::regprocedure),
 'select id into actor from dvfm.employees where telegram_id=p_telegram_id and active for share;',
 'perform 1 from public.employees where telegram_id=p_telegram_id for share;
 select id into actor from dvfm.employees where telegram_id=p_telegram_id and active;');
 execute pg_get_functiondef('public.dvfm_outbox(bigint,uuid,boolean)'::regprocedure);
end $$;
revoke all on function public.dvfm_identity(bigint) from public,anon,authenticated;
grant execute on function public.dvfm_identity(bigint) to service_role;
commit;
