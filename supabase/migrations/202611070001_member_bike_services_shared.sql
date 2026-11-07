-- Publicly viewable group bicycle registry; writes are accepted only by the dedicated Edge Function.
create table if not exists public.voltes_bikes (
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.voltes_riders(id) on delete cascade,
 name text not null check (char_length(trim(name)) between 2 and 90),
 is_default boolean not null default false,
 created_at timestamptz not null default now(),
 unique(member_id,name)
);
create table if not exists public.voltes_bike_services (
 id uuid primary key default gen_random_uuid(),
 bike_id uuid not null references public.voltes_bikes(id) on delete cascade,
 service_date date not null,
 work text not null check (char_length(trim(work)) between 2 and 100),
 km integer check(km between 0 and 1000000),
 notes text not null default '' check(char_length(notes)<=600),
 created_at timestamptz not null default now()
);
create index if not exists voltes_bikes_member_idx on public.voltes_bikes(member_id);
create index if not exists voltes_bike_services_bike_date_idx on public.voltes_bike_services(bike_id,service_date desc);
create unique index if not exists voltes_bikes_single_default_idx on public.voltes_bikes(member_id) where is_default;
alter table public.voltes_bikes enable row level security;
alter table public.voltes_bike_services enable row level security;
revoke all on public.voltes_bikes,public.voltes_bike_services from anon,authenticated;
grant all on public.voltes_bikes,public.voltes_bike_services to service_role;
