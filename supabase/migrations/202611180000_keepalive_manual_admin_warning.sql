-- 5-day manual Keep Alive: server timestamp shared across devices, with one Admin push warning per cycle.
-- The existing daily bike-project-keepalive-daily cron remains untouched.
create table if not exists public.voltes_keepalive_state (
  id boolean primary key default true check (id = true),
  last_pressed_at timestamptz,
  last_notified_for timestamptz
);
alter table public.voltes_keepalive_state enable row level security;
revoke all on table public.voltes_keepalive_state from public, anon, authenticated;
grant select, insert, update on table public.voltes_keepalive_state to service_role;
insert into public.voltes_keepalive_state (id) values (true)
on conflict (id) do nothing;

alter table public.voltes_push_devices
  add column if not exists admin_keepalive_alerts boolean not null default false;

-- Runs once daily, not every minute. When four days have elapsed since the
-- last manual press, sends a single Push to opted-in admin devices only.
select cron.schedule(
 'voltes-keepalive-reminder-daily',
 '10 8 * * *',
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
