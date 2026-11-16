-- Live migration: 20261116045442 voltes_new_ride_web_push
-- Requires existing public.voltes_rides.
-- The Edge Function voltes-push reuses the private VAPID key in reminder_push_secrets.
-- The pg_cron job voltes-push-every-minute is configured separately in production.
-- No public access to Push endpoints/credentials is granted.

create table if not exists public.voltes_push_devices (
 device_id uuid primary key,
 token_hash text not null check(length(token_hash)=64),
 endpoint text not null,
 p256dh text not null,
 auth text not null,
 enabled boolean not null default true,
 last_test_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists voltes_push_devices_enabled_idx on public.voltes_push_devices(enabled) where enabled=true;
alter table public.voltes_push_devices enable row level security;
revoke all on table public.voltes_push_devices from public, anon, authenticated;
grant select,insert,update,delete on table public.voltes_push_devices to service_role;

create table if not exists public.voltes_push_events (
 ride_id uuid primary key references public.voltes_rides(id) on delete cascade,
 created_at timestamptz not null default now(),
 claimed_at timestamptz
);
create index if not exists voltes_push_events_pending_idx on public.voltes_push_events(created_at) where claimed_at is null;
alter table public.voltes_push_events enable row level security;
revoke all on table public.voltes_push_events from public, anon, authenticated;
grant select,insert,update,delete on table public.voltes_push_events to service_role;

create or replace function public.voltes_queue_new_ride_push()
returns trigger
language plpgsql security invoker set search_path=''
as $fn$
begin
 if new.done is false
    and new.date >= ((now() at time zone 'Europe/Athens')::date) then
   insert into public.voltes_push_events(ride_id) values (new.id) on conflict do nothing;
 end if;
 return new;
end;
$fn$;
revoke all on function public.voltes_queue_new_ride_push() from public,anon,authenticated;
grant execute on function public.voltes_queue_new_ride_push() to service_role;
drop trigger if exists voltes_new_ride_push_queue on public.voltes_rides;
create trigger voltes_new_ride_push_queue
 after insert on public.voltes_rides
 for each row execute function public.voltes_queue_new_ride_push();

create or replace function public.voltes_push_claim_events(p_limit integer default 12)
returns table (
 ride_id uuid,
 title text,
 ride_date date,
 ride_time text,
 ride_period text,
 ride_place text
)
language sql security invoker set search_path=''
as $fn$
  with picked as (
   select e.ride_id
   from public.voltes_push_events e
   where e.claimed_at is null
   order by e.created_at
   limit least(greatest(coalesce(p_limit,12),1),24)
   for update skip locked
  ),
  updated as (
   update public.voltes_push_events e
   set claimed_at=now()
   from picked
   where e.ride_id=picked.ride_id
   returning e.ride_id
  )
  select r.id,r.title,r.date,r.time,r.time_period,r.place
  from updated u
  join public.voltes_rides r on r.id=u.ride_id
  where r.done=false;
$fn$;
revoke all on function public.voltes_push_claim_events(integer) from public,anon,authenticated;
grant execute on function public.voltes_push_claim_events(integer) to service_role;
