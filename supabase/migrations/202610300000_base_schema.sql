-- Baseline for an empty Supabase project; later migrations assume these tables exist.
-- Also safe when base tables already exist (e.g. a legacy installation).
create table if not exists public.voltes_riders (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 member boolean not null default false,
 created_at timestamptz not null default now()
);
create unique index if not exists voltes_rider_name_uq
 on public.voltes_riders(lower(trim(name)));

create table if not exists public.voltes_route_templates (
 id uuid primary key default gen_random_uuid(),
 name text not null unique check(char_length(name) between 2 and 100),
 points jsonb not null default '[]'::jsonb
  check(jsonb_typeof(points)='array' and jsonb_array_length(points) between 2 and 6),
 route_type text not null default 'flat' check(route_type in ('flat','mixed','mountain')),
 estimate numeric check(estimate>0 and estimate<=1000),
 created_at timestamptz not null default now()
);

create table if not exists public.voltes_rides (
 id uuid primary key default gen_random_uuid(),
 date date not null,
 time text not null,
 place text not null,
 title text not null default 'Ποδηλατική βόλτα',
 estimate numeric,
 done boolean not null default false,
 km numeric,
 speed numeric,
 strava text,
 attendees jsonb not null default '[]'::jsonb,
 slowed jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now(),
 route_type text not null default 'flat' check(route_type in ('flat','mixed','mountain')),
 public_forecast_minutes integer check(public_forecast_minutes between 1 and 60000),
 route_template_id uuid references public.voltes_route_templates(id) on delete set null,
 route_points jsonb not null default '[]'::jsonb,
 time_period text check(time_period is null or time_period in ('morning','noon','afternoon'))
);

create table if not exists public.voltes_signups (
 id uuid primary key default gen_random_uuid(),
 ride_id uuid not null references public.voltes_rides(id) on delete cascade,
 name text not null,
 created_at timestamptz not null default now()
);
create unique index if not exists voltes_signup_ride_name_uq
 on public.voltes_signups(ride_id,lower(trim(name)));

-- Keep the legacy guest registration trigger available on fresh installations.
create or replace function public.voltes_register_completed_ride_visitors()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.done is true and (tg_op='INSERT' or new.attendees is distinct from old.attendees or new.done is distinct from old.done)
   and jsonb_typeof(new.attendees)='array' then
  insert into public.voltes_riders(name,member)
  select distinct trim(x.name),false
  from jsonb_array_elements_text(new.attendees) as x(name)
  where length(trim(x.name)) between 2 and 70
  on conflict do nothing;
 end if;
 return new;
end $$;
do $$
begin
 if not exists(select 1 from pg_trigger where tgname='voltes_completed_ride_guest_sync' and tgrelid='public.voltes_rides'::regclass) then
  create trigger voltes_completed_ride_guest_sync after insert or update of done,attendees
  on public.voltes_rides for each row execute function public.voltes_register_completed_ride_visitors();
 end if;
end $$;
revoke execute on function public.voltes_register_completed_ride_visitors() from public,anon,authenticated;

-- The later completion/member migrations secure rides, riders and signups.
alter table public.voltes_route_templates enable row level security;
revoke all on public.voltes_route_templates from public,anon,authenticated;
grant select,insert,update,delete on public.voltes_route_templates to service_role;
