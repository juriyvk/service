-- STAGING ONLY. Enables no task sync by itself. No credentials belong in this SQL.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;
create or replace function public.dvfm_staging_configure_you_worker(p_worker_auth text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare secret_id uuid; job_id bigint;
begin
 if p_worker_auth is null or p_worker_auth !~ '^Bearer [A-Za-z0-9_-]+$' or length(p_worker_auth) not between 39 and 263 then raise exception 'Invalid worker Authorization format' using errcode='22023'; end if;
 if has_table_privilege('anon','vault.decrypted_secrets','SELECT') or has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') then raise exception 'Vault must be private' using errcode='42501'; end if;
 if to_regclass('dvfm.yg_config') is null then raise exception 'YouGile migration is required'; end if;
 perform pg_advisory_xact_lock(84513520261113);
 select id into secret_id from vault.secrets where name='dvfm_staging_worker_auth';
 if secret_id is null then secret_id:=vault.create_secret(p_worker_auth,'dvfm_staging_worker_auth','DVFM staging worker Authorization');
 else perform vault.update_secret(secret_id,p_worker_auth); end if;
 job_id:=cron.schedule('dvfm-staging-yougile','* * * * *',$job$select net.http_post(
  url:='https://wepogbvijpvyvyfzxzeo.supabase.co/functions/v1/yougile?worker=1',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization',
   (select decrypted_secret from vault.decrypted_secrets where name='dvfm_staging_worker_auth')),
  body:='{}'::jsonb, timeout_milliseconds:=60000);$job$);
 return jsonb_build_object('configured',true,'job_id',job_id,'job_name','dvfm-staging-yougile','schedule','* * * * *','auth_storage','vault');
end $$;
revoke all on function public.dvfm_staging_configure_you_worker(text) from public,anon,authenticated;
grant execute on function public.dvfm_staging_configure_you_worker(text) to service_role;
notify pgrst, 'reload schema';
commit;
select 'yougile_scheduler_ready' as status;
