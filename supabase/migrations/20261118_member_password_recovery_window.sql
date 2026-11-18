-- Password recovery approvals: one-time token valid for at most one hour.
-- Existing member login and admin PIN remain unchanged.
create table if not exists public.voltes_member_password_resets (
 member_id uuid primary key references public.voltes_riders(id) on delete cascade,
 reset_token_hash text not null check(reset_token_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null
);
alter table public.voltes_member_password_resets enable row level security;
revoke all on public.voltes_member_password_resets from public, anon, authenticated;
grant all on public.voltes_member_password_resets to service_role;

-- The token is consumed, the password replaced, and earlier sessions revoked
-- in one database transaction. Even concurrent attempts cannot reuse a token.
create or replace function public.voltes_member_consume_password_reset(
 p_member_id uuid,
 p_token_hash text,
 p_password_hash text,
 p_salt text,
 p_iterations integer
) returns boolean
language plpgsql security invoker
set search_path = public
as $$
declare consumed uuid;
begin
 if p_member_id is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_password_hash !~ '^[0-9a-f]{64}$'
    or p_salt !~ '^[0-9a-f]{32}$'
    or p_iterations not between 100000 and 600000 then
   raise exception 'invalid recovery parameters' using errcode='22023';
 end if;
 delete from public.voltes_member_password_resets
  where member_id=p_member_id and reset_token_hash=p_token_hash
    and expires_at>now()
  returning member_id into consumed;
 if consumed is null then return false; end if;

 update public.voltes_member_credentials
  set password_hash=p_password_hash, salt=p_salt, iterations=p_iterations,
      updated_at=now()
  where member_id=p_member_id;
 if not found then
   raise exception 'member credentials missing' using errcode='P0002';
 end if;
 delete from public.voltes_member_sessions where member_id=p_member_id;
 return true;
end;
$$;
revoke all on function public.voltes_member_consume_password_reset(
 uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.voltes_member_consume_password_reset(
 uuid,text,text,text,integer) to service_role;
