-- Private member credentials and token sessions for the cycling PWA.
-- These tables are accessible only through verified Edge Functions; no public Data API permissions.
create unique index if not exists voltes_riders_name_fold_unique
  on public.voltes_riders (lower(btrim(name)));

create table if not exists public.voltes_member_credentials (
  member_id uuid primary key references public.voltes_riders(id) on delete cascade,
  password_hash text not null check (password_hash ~ '^[0-9a-f]{64}$'),
  salt text not null check (salt ~ '^[0-9a-f]{32}$'),
  iterations integer not null check (iterations between 100000 and 600000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.voltes_member_sessions (
  token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),
  member_id uuid not null references public.voltes_riders(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '60 days')
);
create index if not exists voltes_member_sessions_owner_expiry
  on public.voltes_member_sessions(member_id,expires_at);
create table if not exists public.voltes_member_login_attempts (
  login_key text primary key check(login_key ~ '^[0-9a-f]{64}$'),
  failures integer not null default 0,
  window_start timestamptz not null default now(),
  blocked_until timestamptz
);
alter table public.voltes_member_credentials enable row level security;
alter table public.voltes_member_sessions enable row level security;
alter table public.voltes_member_login_attempts enable row level security;
revoke all on public.voltes_member_credentials,public.voltes_member_sessions,
  public.voltes_member_login_attempts from public,anon,authenticated;
grant all on public.voltes_member_credentials,public.voltes_member_sessions,
  public.voltes_member_login_attempts to service_role;

-- Transactional registration prevents duplicate/taken names or a half-created account.
create or replace function public.voltes_member_register(
  p_name text,p_hash text,p_salt text,p_iterations integer
) returns uuid language plpgsql security invoker
set search_path = public as $$
declare new_id uuid;
begin
  if p_name<>btrim(p_name) or char_length(p_name) not between 2 and 70
     or p_hash !~ '^[0-9a-f]{64}$'
     or p_salt !~ '^[0-9a-f]{32}$'
     or p_iterations not between 100000 and 600000 then
    raise exception 'invalid member registration' using errcode='22023';
  end if;
  insert into public.voltes_riders(name,member) values (p_name,true)
    returning id into new_id;
  insert into public.voltes_member_credentials(member_id,password_hash,salt,iterations)
    values(new_id,p_hash,p_salt,p_iterations);
  return new_id;
end;
$$;
revoke all on function public.voltes_member_register(text,text,text,integer)
 from public,anon,authenticated;
grant execute on function public.voltes_member_register(text,text,text,integer)
 to service_role;

-- Atomic, per-account throttle across all clients: 7 failures => 15-minute cooldown.
create or replace function public.voltes_member_login_gate(
  p_key text,p_correct boolean
) returns boolean language plpgsql security invoker
set search_path = public as $$
declare item public.voltes_member_login_attempts%rowtype;
begin
  if p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid rate-limit key' using errcode='22023';
  end if;
  insert into public.voltes_member_login_attempts(login_key)
    values(p_key) on conflict do nothing;
  select * into item from public.voltes_member_login_attempts
    where login_key=p_key for update;
  if item.blocked_until is not null and item.blocked_until>now() then
    return false;
  end if;
  if p_correct then
    delete from public.voltes_member_login_attempts where login_key=p_key;
    return true;
  end if;
  if item.window_start < now()-interval '15 minutes' then
    update public.voltes_member_login_attempts set
       failures=1,window_start=now(),blocked_until=null
       where login_key=p_key;
  else
    update public.voltes_member_login_attempts set
       failures=item.failures+1,
       blocked_until=case when item.failures+1>=7 then now()+interval '15 minutes'
                          else null end
       where login_key=p_key;
  end if;
  return false;
end;
$$;
revoke all on function public.voltes_member_login_gate(text,boolean)
 from public,anon,authenticated;
grant execute on function public.voltes_member_login_gate(text,boolean) to service_role;
