-- Apply to a staging copy first. Existing completed rides retain NULL measurements.
begin;
-- All application access already goes through the service-role Edge Function.
-- Block direct browser access to rider identities and slowdown selections.
alter table public.voltes_rides enable row level security;
alter table public.voltes_riders enable row level security;
alter table public.voltes_signups enable row level security;
revoke all on public.voltes_rides, public.voltes_riders, public.voltes_signups from public, anon, authenticated;
grant select, insert, update, delete on public.voltes_rides, public.voltes_riders, public.voltes_signups to service_role;
alter table public.voltes_rides
 add column elevation_gain_m integer check (elevation_gain_m between 0 and 50000),
 add column moving_minutes integer check (moving_minutes between 1 and 59999);
-- Derive ride_id's type from the existing schema (UUID or text).
create table public.voltes_ride_admin_notes as
 select id as ride_id, ''::text as slowdown_notes from public.voltes_rides with no data;
alter table public.voltes_ride_admin_notes
 add primary key (ride_id),
 add foreign key (ride_id) references public.voltes_rides(id) on delete cascade,
 alter column slowdown_notes set not null,
 add check (char_length(slowdown_notes) <= 2000);
alter table public.voltes_ride_admin_notes enable row level security;
revoke all on public.voltes_ride_admin_notes from public, anon, authenticated;
grant select, insert, update, delete on public.voltes_ride_admin_notes to service_role;

-- Only the server service_role may call this atomic completion operation.
create function public.voltes_finish_ride(p_id text, p_details jsonb)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare
 v public.voltes_rides%rowtype;
 person text;
begin
 -- Populate using the real attendees/slowed column types (JSON or SQL arrays).
 select * into v from jsonb_populate_record(null::public.voltes_rides, p_details);
 if v.km is null or v.km < 0.1 or v.km > 1000 or v.speed is null or v.speed < 1 or v.speed > 100
    or v.elevation_gain_m is null or v.moving_minutes is null then
   raise exception 'Invalid completion data' using errcode = '22023';
 end if;
 update public.voltes_rides set done=true, km=v.km, speed=v.speed,
   attendees=v.attendees, slowed=v.slowed, strava=v.strava,
   elevation_gain_m=v.elevation_gain_m, moving_minutes=v.moving_minutes
 where id::text=p_id and done=false;
 if not found then raise exception 'Ride unavailable or already completed' using errcode = 'P0002'; end if;
 insert into public.voltes_ride_admin_notes(ride_id,slowdown_notes)
 select id, coalesce(p_details->>'slowdown_notes','') from public.voltes_rides where id::text=p_id;
 for person in select jsonb_array_elements_text(p_details->'attendees') loop
   if not exists(select 1 from public.voltes_riders where lower(name)=lower(person)) then
     insert into public.voltes_riders(name,member) values(person,false) on conflict do nothing;
   end if;
 end loop;
end;
$$;
revoke all on function public.voltes_finish_ride(text,jsonb) from public, anon, authenticated;
grant execute on function public.voltes_finish_ride(text,jsonb) to service_role;
commit;
