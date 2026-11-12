-- Only manual acceptance by the consenting owner, in staging wepogbvijpvyvyfzxzeo.
-- Replace REPLACE_WITH_YOUR_ID locally with the number returned by /id.
-- Do not commit the filled query, include it in screenshots, or use it in automated tests.
begin;
select set_config('dvfm.self_telegram_id','REPLACE_WITH_YOUR_ID',true);
do $$
declare own_id text:=current_setting('dvfm.self_telegram_id');
begin
 if own_id!~'^[0-9]{1,16}$' or own_id::numeric not between 1 and 9007199254740991 then
  raise exception 'Replace the placeholder with your numeric Telegram ID locally';
 end if;
 if to_regclass('dvfm.employee_ids') is null then raise exception 'Prepared staging CRM is required'; end if;
 if exists(select 1 from public.employees) then
  raise exception 'Employees already exist: stop and inspect; this script is only for initial staging access';
 end if;
end $$;
insert into public.employees(telegram_id,full_name,position,role,is_active)
values(current_setting('dvfm.self_telegram_id')::bigint,'Тестовый руководитель','Ручная приёмка','manager',true);
commit;
select 'manual_staging_access_ready' as status;
