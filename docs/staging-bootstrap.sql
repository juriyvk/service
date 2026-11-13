-- ONLY for a new, empty staging project. Never a replacement for production DDL.
-- Synthetic legacy structure for integration tests; contains no staff records.
begin;
do $$ begin
 if to_regclass('public.employees') is not null then
  raise exception 'Existing employees table detected. Stop: use an empty staging project; do not overwrite the current registry.';
 end if;
end $$;
create table public.employees (
 id uuid primary key default gen_random_uuid(),
 telegram_id bigint unique not null check(telegram_id>0),
 full_name text not null,
 position text,
 role text not null check(role in ('manager','deputy','employee')),
 is_active boolean not null default true
);
alter table public.employees enable row level security;
revoke all on public.employees from public,anon,authenticated;
commit;
