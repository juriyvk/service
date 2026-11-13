-- STAGING ONLY: wepogbvijpvyvyfzxzeo. No secret values belong in this SQL.
-- Installs a service-only configurator; scheduling occurs through the guarded Edge helper.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;
create or replace function public.dvfm_staging_configure_worker(p_worker_auth text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare secret_id uuid; job_id bigint; command text;
begin
 if p_worker_auth is null or p_worker_auth !~ '^Bearer [A-Za-z0-9_-]+$' or length(p_worker_auth) not between 39 and 263 then
  raise exception 'Invalid worker Authorization format' using errcode='22023';
 end if;
 if has_table_privilege('anon','vault.decrypted_secrets','SELECT') or has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') then
  raise exception 'Vault decrypted view must not be readable by client roles' using errcode='42501';
 end if;
 if to_regclass('dvfm.outbox') is null then raise exception 'Prepared CRM is required'; end if;
 perform pg_advisory_xact_lock(84513520261113);
 select id into secret_id from vault.secrets where name='dvfm_staging_worker_auth';
 if secret_id is null then
  secret_id:=vault.create_secret(p_worker_auth,'dvfm_staging_worker_auth','DVFM staging notification worker Authorization');
 else
  perform vault.update_secret(secret_id,p_worker_auth);
 end if;
 command:=$job$select net.http_post(
  url:='https://wepogbvijpvyvyfzxzeo.supabase.co/functions/v1/telegram-webhook?worker=1',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization',
   (select decrypted_secret from vault.decrypted_secrets where name='dvfm_staging_worker_auth')),
  body:='{}'::jsonb, timeout_milliseconds:=30000
 );$job$;
 job_id:=cron.schedule('dvfm-staging-notifications','* * * * *',command);
 return jsonb_build_object('configured',true,'job_id',job_id,'job_name','dvfm-staging-notifications','schedule','* * * * *','auth_storage','vault');
end $$;
revoke all on function public.dvfm_staging_configure_worker(text) from public,anon,authenticated;
grant execute on function public.dvfm_staging_configure_worker(text) to service_role;
notify pgrst, 'reload schema';
commit;
select 'staging_worker_configurator_ready' as status;
