-- Additive, disabled by default. No existing employee, task or external object is changed.
begin;
create table dvfm.yg_config (
 id integer primary key default 1 check(id=1), project_id uuid not null references dvfm.projects,
 remote_project uuid not null, board_id uuid not null, columns jsonb not null,
 actor_id uuid not null references dvfm.employee_ids, enabled boolean not null default false,
 import_new boolean not null default false, scan_column integer not null default 0, scan_offset integer not null default 0,
 watch_cursor uuid, scan_error jsonb, lease uuid, lease_until timestamptz, rate_minute timestamptz, rate_count integer not null default 0
);
create table dvfm.yg_users (
 employee_id uuid primary key references dvfm.employee_ids, remote_user uuid unique not null
);
create table dvfm.yg_links (
 task_id uuid primary key references dvfm.tasks, remote_id uuid unique,
 base_local jsonb, base_remote jsonb, conflict jsonb, resolution jsonb,
 attempts integer not null default 0, retry_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table dvfm.yg_dirty(task_id uuid primary key references dvfm.tasks,version integer not null);
create table dvfm.yg_log (
 id bigint generated always as identity primary key, task_id uuid references dvfm.tasks,
 remote_id uuid, action text not null, result text not null, created_at timestamptz not null default now()
);
do $$ declare name text; begin
 foreach name in array array['yg_config','yg_users','yg_links','yg_dirty','yg_log'] loop
 execute format('alter table dvfm.%I enable row level security',name);
 execute format('revoke all on dvfm.%I from public,anon,authenticated',name);
 end loop;
end $$;
create function dvfm.yg_snapshot(t dvfm.tasks) returns jsonb language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('title',t.title,'description',t.description,'assignee_id',t.assignee_id,'status',t.status,'due_date',t.due_date)
$$;
create function dvfm.yg_enqueue() returns trigger language plpgsql security definer set search_path=pg_catalog,dvfm as $$
begin
 if current_setting('dvfm.yg_origin',true)='pull' then return new; end if;
 if exists(select 1 from dvfm.yg_config where enabled and project_id=new.project_id) then
  insert into dvfm.yg_dirty values(new.id,new.version) on conflict(task_id) do update set version=excluded.version;
  insert into dvfm.yg_links(task_id) values(new.id) on conflict do nothing;
 end if;return new;
end $$;
create trigger yg_local_changes after insert or update on dvfm.tasks for each row execute function dvfm.yg_enqueue();
create function public.dvfm_yg(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,dvfm as $$
declare c dvfm.yg_config; e dvfm.employees; t dvfm.tasks; link dvfm.yg_links;
 actor uuid; target uuid; rid uuid; previous jsonb; desired jsonb; result jsonb; token uuid;
begin
 select * into c from dvfm.yg_config where id=1 for update;
 if p_action='run.claim' and c.id is null then return jsonb_build_object('enabled',false); end if;
 actor:=coalesce(p_actor,c.actor_id);
 perform 1 from public.employees legacy join dvfm.employee_ids m on m.telegram_id=legacy.telegram_id where m.id=actor for share of legacy;
 select * into e from dvfm.employees where id=actor and active and role in ('manager','deputy');
 if not found then raise exception 'forbidden' using errcode='42501'; end if;
 if p_action in ('status','configure','bind','resolve','retry.reset','run.claim') and p_actor is null and p_action<>'run.claim' then raise exception 'forbidden' using errcode='42501'; end if;
 if p_action='status' then
  return jsonb_build_object('config',case when c.id is null then null else to_jsonb(c)-'lease'-'lease_until' end,
   'users',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from dvfm.yg_users x),
   'pending',(select count(*) from dvfm.yg_dirty),
   'issues',(select coalesce(jsonb_agg(jsonb_build_object('task_id',l.task_id,'title',src.title,'local_version',src.version,'remote_id',l.remote_id,'conflict',l.conflict,'attempts',l.attempts,'retry_at',l.retry_at)),'[]') from dvfm.yg_links l join dvfm.tasks src on src.id=l.task_id where l.conflict is not null or l.attempts>0));
 elsif p_action='configure' then
  if c.lease_until>now() then raise exception 'worker busy' using errcode='40001'; end if;
  if not exists(select 1 from dvfm.projects where id=(p_data->>'project_id')::uuid) then raise exception 'unknown CRM project'; end if;
  if not (p_data->'columns' ?& array['pending','in_progress','review','done']) or jsonb_typeof(p_data->'columns')<>'object' then raise exception 'missing columns'; end if;
  if exists(select 1 from jsonb_each_text(p_data->'columns') where key not in ('pending','in_progress','review','done','cancelled') or value!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') then raise exception 'invalid columns'; end if;
  if (select count(*)<>count(distinct value) from jsonb_each_text(p_data->'columns')) then raise exception 'duplicate columns'; end if;
  if c.id is not null and exists(select 1 from dvfm.yg_links) and
   (c.project_id<>(p_data->>'project_id')::uuid or c.remote_project<>(p_data->>'remote_project')::uuid or c.board_id<>(p_data->>'board_id')::uuid or exists(select 1 from jsonb_each_text(c.columns) where p_data->'columns'->>key is distinct from value)) then raise exception 'linked scope cannot be remapped'; end if;
  insert into dvfm.yg_config(id,project_id,remote_project,board_id,columns,actor_id,enabled,import_new)
   values(1,(p_data->>'project_id')::uuid,(p_data->>'remote_project')::uuid,(p_data->>'board_id')::uuid,p_data->'columns',actor,coalesce((p_data->>'enabled')::boolean,false),coalesce((p_data->>'import_new')::boolean,false))
   on conflict(id) do update set actor_id=excluded.actor_id,enabled=excluded.enabled,import_new=excluded.import_new,project_id=excluded.project_id,remote_project=excluded.remote_project,board_id=excluded.board_id,columns=excluded.columns;
  if coalesce((p_data->>'enabled')::boolean,false) then
   insert into dvfm.yg_links(task_id) select id from dvfm.tasks where project_id=(p_data->>'project_id')::uuid on conflict do nothing;
   insert into dvfm.yg_dirty select id,version from dvfm.tasks where project_id=(p_data->>'project_id')::uuid on conflict(task_id) do update set version=excluded.version;
  end if;return jsonb_build_object('configured',true);
 elsif p_action='bind' then
  if c.lease_until>now() then raise exception 'worker busy' using errcode='40001'; end if;
  target:=(p_data->>'employee_id')::uuid;rid:=(p_data->>'remote_user')::uuid;
  if not exists(select 1 from dvfm.employees where id=target and active) then raise exception 'inactive employee'; end if;
  if exists(select 1 from dvfm.yg_users where employee_id=target and remote_user<>rid) and exists(select 1 from dvfm.tasks src join dvfm.yg_links l on l.task_id=src.id where src.assignee_id=target and l.remote_id is not null) then raise exception 'linked user cannot be remapped'; end if;
  insert into dvfm.yg_users values(target,rid) on conflict(employee_id) do update set remote_user=excluded.remote_user;return '{}';
 elsif p_action='retry.reset' then
  select * into t from dvfm.tasks where id=(p_data->>'task_id')::uuid and project_id=c.project_id;
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
  update dvfm.yg_links set attempts=0,retry_at=now(),conflict=null,resolution=null where task_id=t.id;
  insert into dvfm.yg_dirty values(t.id,t.version) on conflict(task_id) do update set version=excluded.version;return '{}';
 elsif p_action='resolve' then
  select * into link from dvfm.yg_links where task_id=(p_data->>'task_id')::uuid for update;
  select * into t from dvfm.tasks where id=link.task_id;
  if link.conflict is null or link.conflict->>'id' is distinct from p_data->>'conflict_id' or t.version is distinct from (p_data->>'version')::integer then raise exception 'stale conflict' using errcode='40001'; end if;
  if p_data->>'choice' is null or p_data->>'choice' not in ('local','remote') then raise exception 'invalid resolution'; end if;
  update dvfm.yg_links set resolution=jsonb_build_object('choice',p_data->>'choice','version',t.version,'remote',link.conflict->'remote'),retry_at=now(),attempts=0 where task_id=t.id;
  insert into dvfm.yg_dirty values(t.id,t.version) on conflict(task_id) do update set version=excluded.version;return '{}';
 elsif p_action='run.claim' then
  if c.id is null or not c.enabled then return jsonb_build_object('enabled',false); end if;
  if c.lease_until>now() then return jsonb_build_object('busy',true); end if;
  token:=gen_random_uuid();update dvfm.yg_config set lease=token,lease_until=now()+interval '2 minutes' where id=1;
  return jsonb_build_object('config',to_jsonb(c),'lease',token,'users',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from dvfm.yg_users x));
 end if;
 -- All following operations require the leased, enabled connection and its active authority.
 if c.id is null or not c.enabled or c.lease is distinct from (p_data->>'lease')::uuid or c.lease_until<=now() then raise exception 'invalid sync lease' using errcode='42501'; end if;
 if p_action='run.release' then update dvfm.yg_config set lease=null,lease_until=null where id=1;return '{}';
 elsif p_action='permit' then
  if c.rate_minute is distinct from date_trunc('minute',now()) then update dvfm.yg_config set rate_minute=date_trunc('minute',now()),rate_count=1 where id=1;return 'true'; end if;
  if c.rate_count>=30 then return 'false'; end if;
  update dvfm.yg_config set rate_count=rate_count+1 where id=1;return 'true';
 elsif p_action='allow_import' then
  return to_jsonb(not exists(select 1 from dvfm.yg_links where remote_id is null));
 elsif p_action='watch' then
  return (select coalesce(jsonb_agg(jsonb_build_object('task',to_jsonb(src),'link',to_jsonb(l))),'[]') from
   (select src.* from dvfm.tasks src join dvfm.yg_links l on l.task_id=src.id where l.remote_id is not null
    and (c.watch_cursor is null or src.id>c.watch_cursor) and l.attempts<10 and l.retry_at<=now()
    and (l.conflict is null or l.resolution is not null) order by src.id limit 5) src join dvfm.yg_links l on l.task_id=src.id);
 elsif p_action='watch.advance' then
  update dvfm.yg_config set watch_cursor=nullif(p_data->>'task_id','')::uuid where id=1;return '{}';
 elsif p_action='scan.error' then
  update dvfm.yg_config set scan_error=jsonb_build_object('remote_id',p_data->>'remote_id','reason',left(p_data->>'reason',100)) where id=1;return '{}';
 elsif p_action='scan.advance' then
  update dvfm.yg_config set scan_column=(p_data->>'column')::integer,scan_offset=(p_data->>'offset')::integer where id=1;return '{}';
 elsif p_action='work' then
  return (select coalesce(jsonb_agg(jsonb_build_object('task',to_jsonb(src),'link',to_jsonb(l))),'[]') from
   (select src.* from dvfm.yg_dirty q join dvfm.tasks src on src.id=q.task_id join dvfm.yg_links l on l.task_id=src.id
    where l.attempts<10 and l.retry_at<=now() and (l.conflict is null or l.resolution is not null) order by l.updated_at limit 5) src join dvfm.yg_links l on l.task_id=src.id);
 elsif p_action='lookup' then
  select * into link from dvfm.yg_links where remote_id=(p_data->>'remote_id')::uuid;
  if not found then return null; end if;
  return (select jsonb_build_object('task',to_jsonb(src),'link',to_jsonb(link)) from dvfm.tasks src where id=link.task_id);
 end if;
 target:=nullif(p_data->>'task_id','')::uuid;rid:=nullif(p_data->>'remote_id','')::uuid;
 if p_action='import' then
  if not c.import_new then return null; end if;
  select task_id into target from dvfm.yg_links where remote_id=rid;
  if found then return jsonb_build_object('existing',true,'task_id',target); end if;
  if rid is null then raise exception 'remote ID required'; end if;
  desired:=p_data->'remote';
  if not exists(select 1 from dvfm.yg_users u join dvfm.employees person on person.id=u.employee_id and person.active where u.employee_id=(desired->>'assignee_id')::uuid) then raise exception 'unbound assignee' using errcode='42501'; end if;
  perform set_config('dvfm.yg_origin','pull',true);
  result:=public.dvfm_crm(actor,'task.create',desired||jsonb_build_object('project_id',c.project_id));target:=(result->>'id')::uuid;
  select * into t from dvfm.tasks where id=target;
  insert into dvfm.yg_links(task_id,remote_id,base_local,base_remote,conflict) values(target,rid,dvfm.yg_snapshot(t),desired,
   case when desired->>'status'<>'pending' then jsonb_build_object('id',gen_random_uuid(),'reason','acceptance_required','version',t.version,'remote',desired) else null end);
  insert into dvfm.yg_log(task_id,remote_id,action,result) values(target,rid,'import','ok');
  return jsonb_build_object('task',to_jsonb(t));
 end if;
 select * into t from dvfm.tasks where id=target for update;
 if not found or (t.project_id<>c.project_id and p_action not in ('conflict','retry')) then raise exception 'task outside configured project' using errcode='42501'; end if;
 select * into link from dvfm.yg_links where task_id=target for update;
 if p_action='validate' then
  if t.version is distinct from (p_data->>'version')::integer then raise exception 'version conflict' using errcode='40001'; end if;
  if not exists(select 1 from dvfm.yg_users u join dvfm.employees person on person.id=u.employee_id and person.active where u.employee_id=t.assignee_id) then raise exception 'inactive or unbound assignee' using errcode='42501'; end if;
  return 'true';
 elsif p_action='conflict' then
  update dvfm.yg_links set conflict=jsonb_build_object('id',gen_random_uuid(),'reason',left(p_data->>'reason',100),'version',t.version,'remote',p_data->'remote','fields',p_data->'fields'),resolution=null,updated_at=now() where task_id=target;
  insert into dvfm.yg_log(task_id,remote_id,action,result) values(target,link.remote_id,'conflict',left(p_data->>'reason',100));return '{}';
 elsif p_action='retry' then
  update dvfm.yg_links set attempts=least(attempts+1,10),retry_at=now()+interval '2 minutes',updated_at=now() where task_id=target;
  insert into dvfm.yg_log(task_id,remote_id,action,result) values(target,link.remote_id,'retry','remote_unavailable');return '{}';
 elsif p_action in ('ack','pull') then
  if rid is null or link.remote_id is not null and link.remote_id<>rid then raise exception 'remote mapping mismatch'; end if;
  if p_action='pull' then
   if t.version is distinct from (p_data->>'version')::integer then raise exception 'version conflict' using errcode='40001'; end if;
   desired:=p_data->'desired';previous:=to_jsonb(t);
   if not exists(select 1 from dvfm.yg_users u join dvfm.employees person on person.id=u.employee_id and person.active where u.employee_id=(desired->>'assignee_id')::uuid) then raise exception 'unbound assignee' using errcode='42501'; end if;
   if t.status in ('done','cancelled') and desired->>'status'<>t.status then raise exception 'terminal state cannot be reopened' using errcode='22023'; end if;
   if (desired->>'assignee_id')::uuid<>t.assignee_id and desired->>'status'<>'pending' then raise exception 'reassignment requires pending' using errcode='22023'; end if;
   if (desired->>'assignee_id')::uuid=t.assignee_id and desired->>'status'<>t.status then
    if not ((t.status='accepted' and desired->>'status'='in_progress') or (t.status='in_progress' and desired->>'status'='review') or (t.status='review' and desired->>'status' in ('in_progress','done')) or (desired->>'status'='cancelled' and t.status not in ('done','cancelled'))) then raise exception 'acceptance or valid transition required' using errcode='22023'; end if;
   end if;
   if desired->>'status'='done' and exists(select 1 from dvfm.checkpoints where task_id=target and not done) then raise exception 'open checkpoints' using errcode='22023'; end if;
   perform set_config('dvfm.yg_origin','pull',true);
   update dvfm.tasks set title=desired->>'title',description=desired->>'description',due_date=nullif(desired->>'due_date','')::date,
    assignee_id=(desired->>'assignee_id')::uuid,status=desired->>'status',
    accepted_at=case when (desired->>'assignee_id')::uuid<>t.assignee_id then null else accepted_at end,
    progress=case when (desired->>'assignee_id')::uuid<>t.assignee_id then 0 when desired->>'status'='done' then 100 else progress end,
    version=version+1,updated_at=now() where id=target returning * into t;
   insert into dvfm.history(task_id,actor_id,action,before_data,after_data) values(target,actor,'yougile.pull',previous,to_jsonb(t));
   insert into dvfm.outbox(employee_id,task_id,text) select id,target,'Задача обновлена в YouGile: '||t.title from dvfm.employees where active and id in(t.creator_id,t.assignee_id) and id<>actor;
  end if;
  update dvfm.yg_links set remote_id=rid,base_local=case when p_action='pull' then dvfm.yg_snapshot(t) else p_data->'local' end,
   base_remote=p_data->'remote',conflict=null,resolution=null,attempts=0,retry_at=now(),updated_at=now() where task_id=target;
  delete from dvfm.yg_dirty where task_id=target and version=(p_data->>'version')::integer;
  insert into dvfm.yg_log(task_id,remote_id,action,result) values(target,rid,p_action,'ok');return jsonb_build_object('task',to_jsonb(t));
 end if;
 raise exception 'unknown sync action' using errcode='22023';
end $$;
revoke all on function public.dvfm_yg(uuid,text,jsonb),dvfm.yg_snapshot(dvfm.tasks),dvfm.yg_enqueue() from public,anon,authenticated;
grant execute on function public.dvfm_yg(uuid,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
