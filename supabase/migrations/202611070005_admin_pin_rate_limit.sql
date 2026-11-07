-- Durable shared Admin-PIN throttle, at most 5 failed tries per 15-minute window per connection key.
create table if not exists public.voltes_admin_login_attempts(
 key_hash text primary key check(key_hash ~ '^[0-9a-f]{64}$'),
 window_started_at timestamptz not null default now(),
 failures integer not null default 0,
 blocked_until timestamptz
);
alter table public.voltes_admin_login_attempts enable row level security;
revoke all on public.voltes_admin_login_attempts from anon,authenticated;
grant select,insert,update,delete on public.voltes_admin_login_attempts to service_role;
create or replace function public.voltes_admin_login_gate(p_key text,p_correct boolean)
returns boolean language plpgsql security invoker set search_path=public as $$
declare current_row record; new_failures integer; now_time timestamptz := clock_timestamp();
begin
 if p_key !~ '^[0-9a-f]{64}$' then return false; end if;
 delete from public.voltes_admin_login_attempts where window_started_at<now_time-interval '2 days';
 insert into public.voltes_admin_login_attempts(key_hash,window_started_at,failures) values(p_key,now_time,0) on conflict do nothing;
 select * into current_row from public.voltes_admin_login_attempts where key_hash=p_key for update;
 if current_row.blocked_until is not null and current_row.blocked_until>now_time then return false; end if;
 if p_correct then
  delete from public.voltes_admin_login_attempts where key_hash=p_key;return true;
 end if;
 new_failures:=case when current_row.window_started_at<now_time-interval '15 minutes' then 1 else current_row.failures+1 end;
 update public.voltes_admin_login_attempts set
  window_started_at=case when current_row.window_started_at<now_time-interval '15 minutes' then now_time else current_row.window_started_at end,
  failures=new_failures,
  blocked_until=case when new_failures>=6 then now_time+interval '30 minutes' else null end
 where key_hash=p_key;
 return false;
end $$;
revoke all on function public.voltes_admin_login_gate(text,boolean) from public,anon,authenticated;
grant execute on function public.voltes_admin_login_gate(text,boolean) to service_role;
