-- Read-only status; does not return credentials, task contents or employee IDs.
with report as (
 select 1 as n,'cron' as section,coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) as details
 from (select jobid,jobname,schedule,active from cron.job where jobname='dvfm-staging-notifications') x
 union all
 select 2,'recent_cron_runs',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
 from (select status,return_message,start_time,end_time from cron.job_run_details
       where jobid in(select jobid from cron.job where jobname='dvfm-staging-notifications')
       order by start_time desc limit 5) x
 union all
 select 3,'queue',jsonb_build_object('pending',count(*) filter(where sent_at is null),
  'exhausted',count(*) filter(where sent_at is null and attempts>=10)) from dvfm.outbox
)
select section,details from report order by n;
-- Cron success confirms enqueueing HTTP via pg_net, not Telegram delivery.
-- Telegram delivery is confirmed by outbox.sent_at and the received message.
