-- Phase 2: move component-storage reconciliation from hourly to daily cadence.
-- Runs once per day at 00:17 UTC.

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'component-storage-reconcile-hourly'
  ) then
    perform cron.unschedule('component-storage-reconcile-hourly');
  end if;

  if exists (
    select 1
    from cron.job
    where jobname = 'component-storage-reconcile-daily'
  ) then
    perform cron.unschedule('component-storage-reconcile-daily');
  end if;

  perform cron.schedule(
    'component-storage-reconcile-daily',
    '17 0 * * *',
    $cron$
    select
      net.http_post(
        url:= (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
          || '/functions/v1/component-storage-reconcile',
        headers:= jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
        ),
        body:= jsonb_build_object(
          'source', 'pg_cron',
          'scheduled_at', now()
        ),
        timeout_milliseconds:= 15000
      ) as request_id;
    $cron$
  );
end
$$;
