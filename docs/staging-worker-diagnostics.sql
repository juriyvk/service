-- Read-only. No secrets or employee records are returned. Safe before worker installation.
with report as (
 select 1 as n,'worker_rpc' as section,jsonb_build_object(
  'exists',to_regprocedure('public.dvfm_staging_configure_worker(text)') is not null,
  'server_execute',coalesce(has_function_privilege('service_role',to_regprocedure('public.dvfm_staging_configure_worker(text)'),'EXECUTE'),false)
 ) as details
 union all
 select 2,'extensions',coalesce(jsonb_agg(extname order by extname),'[]'::jsonb)
 from pg_extension where extname in ('pg_cron','pg_net','supabase_vault')
 union all
 select 3,'vault',jsonb_build_object(
  'decrypted_view_exists',to_regclass('vault.decrypted_secrets') is not null,
  'anon_select',coalesce(has_table_privilege('anon',to_regclass('vault.decrypted_secrets'),'SELECT'),false),
  'authenticated_select',coalesce(has_table_privilege('authenticated',to_regclass('vault.decrypted_secrets'),'SELECT'),false)
 )
)
select section,details from report order by n;
