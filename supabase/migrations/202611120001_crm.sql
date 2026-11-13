-- Additive migration: never alters legacy employee/auth tables.
begin;
create schema if not exists dvfm;
revoke all on schema dvfm from public, anon, authenticated;
create table dvfm.employees (
 id uuid primary key default gen_random_uuid(), telegram_id bigint unique not null check(telegram_id>0),
 full_name text not null check(length(full_name) between 1 and 120),
 role text not null check(role in ('manager','deputy','employee')), active boolean not null default true
);
create table dvfm.projects (
 id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 1 and 160),
 owner_id uuid not null references dvfm.employees, created_at timestamptz not null default now()
);
create table dvfm.tasks (
 id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 1 and 240),
 description text not null default '' check(length(description)<=10000), project_id uuid references dvfm.projects,
 creator_id uuid not null references dvfm.employees, assignee_id uuid not null references dvfm.employees,
 status text not null default 'pending' check(status in ('pending','accepted','in_progress','review','done','cancelled')),
 progress integer not null default 0 check(progress between 0 and 100), due_date date,
 accepted_at timestamptz, version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(status<>'done' or progress=100)
);
create index on dvfm.tasks(assignee_id,status,due_date);
create table dvfm.checkpoints (
 id uuid primary key default gen_random_uuid(), task_id uuid not null references dvfm.tasks,
 title text not null check(length(title) between 1 and 240), due_date date, done boolean not null default false
);
create table dvfm.comments (
 id uuid primary key default gen_random_uuid(), task_id uuid not null references dvfm.tasks,
 author_id uuid not null references dvfm.employees, body text not null check(length(body) between 1 and 4000), created_at timestamptz not null default now()
);
create table dvfm.history (
 id bigint generated always as identity primary key, task_id uuid not null references dvfm.tasks,
 actor_id uuid not null references dvfm.employees, action text not null, before_data jsonb, after_data jsonb, created_at timestamptz not null default now()
);
create table dvfm.documents (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references dvfm.employees,
 name text not null check(length(name) between 1 and 240), path text unique not null, mime text not null,
 size integer not null check(size between 1 and 10485760), ready boolean not null default false, created_at timestamptz not null default now()
);
create table dvfm.bot_updates(update_id bigint primary key, result jsonb, created_at timestamptz not null default now());
create table dvfm.outbox (
 id bigint generated always as identity primary key, employee_id uuid not null references dvfm.employees,
 task_id uuid references dvfm.tasks, text text not null, sent_at timestamptz, attempts integer not null default 0,
 available_at timestamptz not null default now(), lease_until timestamptz, lease_token uuid, created_at timestamptz not null default now()
);
-- Defense in depth: private schema, RLS and no direct client grants.
do $$ declare t text; begin
 foreach t in array array['employees','projects','tasks','checkpoints','comments','history','documents','bot_updates','outbox'] loop
 execute format('alter table dvfm.%I enable row level security',t);
 execute format('revoke all on dvfm.%I from public, anon, authenticated',t);
 end loop;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('dvfm-private','dvfm-private',false,10485760,array['application/pdf','image/jpeg','image/png','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do nothing;
-- Restrictive policies also fence off this bucket if legacy permissive policies exist.
create policy dvfm_private_fence on storage.objects as restrictive for all to anon,authenticated
using (bucket_id <> 'dvfm-private') with check (bucket_id <> 'dvfm-private');
-- Abort rather than silently use an unsafe existing bucket.
do $$ begin
 if exists(select 1 from storage.buckets where id='dvfm-private' and public) then raise exception 'dvfm-private must be private'; end if;
end $$;
create function public.dvfm_identity(p_telegram_id bigint) returns jsonb
language sql security definer set search_path=pg_catalog,dvfm as $$
 select jsonb_build_object('id',id,'full_name',full_name,'role',role) from dvfm.employees where telegram_id=p_telegram_id and active
$$;
create function public.dvfm_crm(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,dvfm as $$
declare e dvfm.employees; t dvfm.tasks; old_t jsonb; result jsonb; target uuid; pid uuid; did uuid; cp dvfm.checkpoints; elevated boolean;
begin
 select * into e from dvfm.employees where id=p_actor and active for share;
 if not found then raise exception 'forbidden' using errcode='42501'; end if;
 elevated := e.role in ('manager','deputy');
 if p_action='snapshot' then
 return jsonb_build_object(
 'employee',jsonb_build_object('id',e.id,'full_name',e.full_name,'role',e.role),
 'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'full_name',full_name,'role',role)),'[]') from dvfm.employees where active and (elevated or id=e.id)),
 'tasks',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from dvfm.tasks x where elevated or e.id in(x.creator_id,x.assignee_id)),
 'projects',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from dvfm.projects x where elevated or x.owner_id=e.id or exists(select 1 from dvfm.tasks visible_task where visible_task.project_id=x.id and e.id in(visible_task.creator_id,visible_task.assignee_id))),
 'documents',(select coalesce(jsonb_agg(to_jsonb(x)-'path'),'[]') from dvfm.documents x where owner_id=e.id and ready));
 elsif p_action='project.create' then
 if not elevated then raise exception 'forbidden' using errcode='42501'; end if;
 target:=coalesce(nullif(p_data->>'owner_id','')::uuid,e.id);
 if not exists(select 1 from dvfm.employees where id=target and active) then raise exception 'inactive owner'; end if;
 insert into dvfm.projects(title,owner_id) values(trim(p_data->>'title'),target) returning to_jsonb(projects.*) into result; return result;
 elsif p_action='document.reserve' then
 did:=gen_random_uuid();
 insert into dvfm.documents(id,owner_id,name,path,mime,size) values(did,e.id,p_data->>'name',e.id||'/'||did,p_data->>'mime',(p_data->>'size')::integer) returning to_jsonb(documents.*) into result; return result;
 elsif p_action in ('document.get','document.complete') then
 select id into did from dvfm.documents where id=(p_data->>'id')::uuid and owner_id=e.id for update;
 if not found then raise exception 'forbidden' using errcode='42501'; end if;
 if p_action='document.complete' then update dvfm.documents set ready=true where id=did; end if;
 return (select to_jsonb(d) from dvfm.documents d where id=did);
 elsif p_action='task.create' then
 target:=coalesce(nullif(p_data->>'assignee_id','')::uuid,e.id);
 if not elevated and target<>e.id then raise exception 'forbidden' using errcode='42501'; end if;
 if not exists(select 1 from dvfm.employees where id=target and active) then raise exception 'inactive assignee'; end if;
 pid:=nullif(p_data->>'project_id','')::uuid;
 if pid is not null and not exists(select 1 from dvfm.projects p where p.id=pid and (elevated or p.owner_id=e.id or exists(select 1 from dvfm.tasks x where x.project_id=p.id and e.id in(x.creator_id,x.assignee_id)))) then raise exception 'forbidden' using errcode='42501'; end if;
 insert into dvfm.tasks(title,description,project_id,creator_id,assignee_id,due_date)
 values(trim(p_data->>'title'),coalesce(p_data->>'description',''),pid,e.id,target,nullif(p_data->>'due_date','')::date) returning * into t;
 else
 select * into t from dvfm.tasks where id=(p_data->>'id')::uuid for update;
 if not found or not(elevated or e.id in(t.creator_id,t.assignee_id)) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_action='task.detail' then
 return jsonb_build_object('task',to_jsonb(t),'checkpoints',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from dvfm.checkpoints x where task_id=t.id),'comments',(select coalesce(jsonb_agg(to_jsonb(x) order by created_at),'[]') from dvfm.comments x where task_id=t.id),'history',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from dvfm.history x where task_id=t.id));
 end if;
 old_t:=to_jsonb(t);
 if p_action='comment.create' then
 insert into dvfm.comments(task_id,author_id,body) values(t.id,e.id,trim(p_data->>'body')) returning to_jsonb(comments.*) into result;
 elsif p_action='checkpoint.create' then
 if not(elevated or e.id=t.creator_id) or t.status in ('done','cancelled') then raise exception 'forbidden' using errcode='42501'; end if;
 insert into dvfm.checkpoints(task_id,title,due_date) values(t.id,trim(p_data->>'title'),nullif(p_data->>'due_date','')::date) returning to_jsonb(checkpoints.*) into result;
 elsif p_action='checkpoint.toggle' then
 if not(elevated or e.id=t.assignee_id) or t.status not in ('accepted','in_progress','review') then raise exception 'forbidden' using errcode='42501'; end if;
 update dvfm.checkpoints set done=(p_data->>'done')::boolean where id=(p_data->>'checkpoint_id')::uuid and task_id=t.id returning to_jsonb(checkpoints.*) into result;
 if result is null then raise exception 'checkpoint missing'; end if;
 elsif p_action='task.accept' then
 if e.id<>t.assignee_id or t.status<>'pending' then raise exception 'forbidden' using errcode='42501'; end if;
 update dvfm.tasks set status='accepted',accepted_at=now(),version=version+1,updated_at=now() where id=t.id returning * into t;
 elsif p_action='task.update' then
 if (p_data->>'version')::integer is distinct from t.version then raise exception 'version conflict' using errcode='40001'; end if;
 if not(elevated or e.id=t.assignee_id) then raise exception 'forbidden' using errcode='42501'; end if;
 if not (
 (t.status='accepted' and p_data->>'status' in ('accepted','in_progress')) or
 (t.status='in_progress' and p_data->>'status' in ('in_progress','review')) or
 (t.status='review' and p_data->>'status' in ('review','in_progress')) or
 (t.status='review' and p_data->>'status'='done' and (elevated or e.id=t.creator_id)) or
 (p_data->>'status'='cancelled' and t.status not in ('done','cancelled') and (elevated or e.id=t.creator_id))
 ) then raise exception 'invalid transition' using errcode='22023'; end if;
 if p_data->>'status'='done' and exists(select 1 from dvfm.checkpoints where task_id=t.id and not done) then raise exception 'open checkpoints' using errcode='22023'; end if;
 update dvfm.tasks set status=p_data->>'status',progress=case when p_data->>'status'='done' then 100 else (p_data->>'progress')::integer end,version=version+1,updated_at=now() where id=t.id returning * into t;
 else raise exception 'unknown action' using errcode='22023';
 end if;
 end if;
 insert into dvfm.history(task_id,actor_id,action,before_data,after_data) values(t.id,e.id,p_action,old_t,coalesce(result,to_jsonb(t)));
 insert into dvfm.outbox(employee_id,task_id,text)
 select id,t.id,'Задача: '||t.title||' · '||p_action from dvfm.employees where active and id in(t.creator_id,t.assignee_id) and id<>e.id;
 return coalesce(result,to_jsonb(t));
end $$;
-- Bot actions and durable notifications remain service-only.
create function public.dvfm_bot(p_update_id bigint,p_telegram_id bigint,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,dvfm as $$
declare actor uuid; bot_result jsonb; begin
 select id into actor from dvfm.employees where telegram_id=p_telegram_id and active for share;
 if actor is null then raise exception 'forbidden' using errcode='42501'; end if;
 insert into dvfm.bot_updates(update_id) values(p_update_id) on conflict do nothing;
 if not found then
 if p_action='document.reserve' then return (select b.result from dvfm.bot_updates b where update_id=p_update_id); end if;
 return jsonb_build_object('duplicate',true); end if;
 bot_result:=public.dvfm_crm(actor,p_action,p_data);
 update dvfm.bot_updates set result=bot_result where update_id=p_update_id;
 if p_action='task.create' then
 insert into dvfm.outbox(employee_id,task_id,text) values(actor,(bot_result->>'id')::uuid,'Задача создана: '||(bot_result->>'title'));
 end if;
 return bot_result;
end $$;
create function public.dvfm_outbox(p_id bigint default null,p_token uuid default null,p_success boolean default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,dvfm as $$
declare result jsonb; begin
 if p_id is not null then
 update dvfm.outbox set sent_at=case when p_success then now() else null end,lease_until=null,lease_token=null,available_at=now()+interval '2 minutes'
 where id=p_id and lease_token=p_token and sent_at is null; return '{}';
 end if;
 with picked as (select id from dvfm.outbox where sent_at is null and available_at<=now() and (lease_until is null or lease_until<now()) and attempts<10 order by id for update skip locked limit 20),
 leased as (update dvfm.outbox o set attempts=attempts+1,lease_until=now()+interval '90 seconds',lease_token=gen_random_uuid() from picked where o.id=picked.id returning o.*)
 select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('telegram_id',e.telegram_id)),'[]') into result from leased l join dvfm.employees e on e.id=l.employee_id and e.active;
 return result;
end $$;
revoke all on function public.dvfm_identity(bigint),public.dvfm_crm(uuid,text,jsonb),public.dvfm_bot(bigint,bigint,text,jsonb),public.dvfm_outbox(bigint,uuid,boolean) from public,anon,authenticated;
grant execute on function public.dvfm_identity(bigint),public.dvfm_crm(uuid,text,jsonb),public.dvfm_bot(bigint,bigint,text,jsonb),public.dvfm_outbox(bigint,uuid,boolean) to service_role;
commit;
