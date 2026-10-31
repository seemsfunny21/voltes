begin;
alter table public.voltes_riders add column avatar_data_url text
 check(avatar_data_url is null or (length(avatar_data_url)<=90000 and avatar_data_url ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'));
alter table public.voltes_signups add column cancel_token_hash text
 check(cancel_token_hash is null or cancel_token_hash ~ '^[0-9a-f]{64}$');
create unique index voltes_signups_ride_cancel_token on public.voltes_signups(ride_id,cancel_token_hash) where cancel_token_hash is not null;
create table public.voltes_admin_sessions(
 token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),
 pin_version text not null,
 created_at timestamptz not null default now()
);
alter table public.voltes_admin_sessions enable row level security;
revoke all on public.voltes_admin_sessions from public,anon,authenticated;
grant select,insert,delete on public.voltes_admin_sessions to service_role;

-- Ride-level locks serialize signup/cancellation with completion.
create function public.voltes_signup(p_id uuid,p_name text,p_hash text default null)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform 1 from public.voltes_rides where id=p_id and not done for update;
 if not found then raise exception 'Ride closed' using errcode='P0002'; end if;
 if p_hash is not null and exists(select 1 from public.voltes_signups where ride_id=p_id and cancel_token_hash=p_hash) then return; end if;
 insert into public.voltes_signups(ride_id,name,cancel_token_hash) values(p_id,p_name,p_hash);
end;$$;
create function public.voltes_cancel_signup(p_id uuid,p_hash text)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform 1 from public.voltes_rides where id=p_id and not done for update;
 if not found then raise exception 'Ride closed' using errcode='P0002'; end if;
 delete from public.voltes_signups where ride_id=p_id and cancel_token_hash=p_hash;
 -- Idempotent retries do not reveal whether another person's signup exists.
end;$$;
revoke all on function public.voltes_signup(uuid,text,text) from public,anon,authenticated;
revoke all on function public.voltes_cancel_signup(uuid,text) from public,anon,authenticated;
grant execute on function public.voltes_signup(uuid,text,text) to service_role;
grant execute on function public.voltes_cancel_signup(uuid,text) to service_role;
commit;
