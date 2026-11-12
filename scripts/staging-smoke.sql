-- Real PostgreSQL smoke checks, rolled back before setup is committed.
savepoint synthetic_checks;
insert into public.employees(id,telegram_id,full_name,position,role,is_active) values
 ('f0000000-0000-4000-8000-000000000001',920000001,'Synthetic manager','Fixture','manager',true),
 ('f0000000-0000-4000-8000-000000000002',920000002,'Synthetic deputy','Fixture','deputy',true),
 ('f0000000-0000-4000-8000-000000000003',920000003,'Synthetic employee','Fixture','employee',true);
do $$
declare manager_id uuid; deputy_id uuid; employee_id uuid; task jsonb; doc jsonb; denied boolean:=false;
begin
 manager_id:=(public.dvfm_identity(920000001)->>'id')::uuid;
 deputy_id:=(public.dvfm_identity(920000002)->>'id')::uuid;
 employee_id:=(public.dvfm_identity(920000003)->>'id')::uuid;
 if manager_id is null or deputy_id is null or employee_id is null then raise exception 'Identity bridge failed'; end if;
 if public.dvfm_identity(920000001)->>'legacy_id'<>'f0000000-0000-4000-8000-000000000001' then raise exception 'Legacy ID changed'; end if;
 task:=public.dvfm_crm(manager_id,'task.create',jsonb_build_object('title','Synthetic smoke task','assignee_id',employee_id));
 task:=public.dvfm_crm(employee_id,'task.accept',jsonb_build_object('id',task->>'id'));
 if task->>'status'<>'accepted' then raise exception 'Acceptance failed'; end if;
 begin
  perform public.dvfm_crm(employee_id,'task.create',jsonb_build_object('title','Forbidden assignment','assignee_id',deputy_id));
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Employee assignment escaped authorization'; end if;
 doc:=public.dvfm_crm(employee_id,'document.reserve','{"name":"fixture.txt","mime":"text/plain","size":1}');
 denied:=false;
 begin
  perform public.dvfm_crm(manager_id,'document.get',jsonb_build_object('id',doc->>'id'));
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Private document isolation failed'; end if;
 update public.employees set is_active=false where telegram_id=920000003;
 if public.dvfm_identity(920000003) is not null then raise exception 'Revoked identity still accepted'; end if;
 denied:=false;
 begin
  perform public.dvfm_crm(employee_id,'snapshot');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Revoked actor still accepted'; end if;
 if has_function_privilege('anon','public.dvfm_crm(uuid,text,jsonb)','execute')
 or has_function_privilege('authenticated','public.dvfm_crm(uuid,text,jsonb)','execute')
 or has_schema_privilege('anon','dvfm','usage')
 or has_schema_privilege('authenticated','dvfm','usage') then raise exception 'Unexpected client privilege'; end if;
 if not has_function_privilege('service_role','public.dvfm_crm(uuid,text,jsonb)','execute') then raise exception 'Server RPC grant missing'; end if;
 if not exists(select 1 from storage.buckets where id='dvfm-private' and not public) then raise exception 'Private bucket missing'; end if;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='dvfm_private_fence' and permissive='RESTRICTIVE') then raise exception 'Storage fence missing'; end if;
end $$;
rollback to savepoint synthetic_checks;
release savepoint synthetic_checks;
