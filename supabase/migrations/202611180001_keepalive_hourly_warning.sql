-- One warning per manual Keep Alive cycle; dispatch a small check hourly
-- so the warning arrives near day 4 rather than possibly just before day 5.
select cron.unschedule('voltes-keepalive-reminder-daily');
select cron.schedule(
 'voltes-keepalive-reminder-hourly',
 '10 * * * *',
 $cron$select net.http_post(
   url := 'https://zrbmsziipzabnniqcpav.supabase.co/functions/v1/voltes-push',
   headers := jsonb_build_object(
    'Content-Type','application/json',
    'X-Reminder-Cron-Secret',(select value->>'token' from public.reminder_push_secrets where name='cron')
   ),
   body := '{"action":"keepaliveReminder"}'::jsonb,
   timeout_milliseconds := 15000
 );$cron$
);
