
alter table voltes_game.activities add column if not exists official_ride_id uuid;
create unique index if not exists voltes_game_official_ride_player on voltes_game.activities(official_ride_id,player) where official_ride_id is not null;
create table if not exists voltes_game.official_ride_log(ride_id uuid primary key,processed_at timestamptz not null default now(),status text not null check(status in ('credited','review')),credited integer not null default 0,skipped integer not null default 0,detail text);
alter table voltes_game.official_ride_log enable row level security;
grant all on voltes_game.official_ride_log to service_role;
create or replace function voltes_game.credit_official_ride() returns trigger language plpgsql security invoker set search_path='' as $$
declare ids uuid[]; who uuid; people int; mu numeric; rateval int; base int; rewardval int; aid uuid; credited int:=0; skipped int:=0;
begin
 if new.done is not true or new.km is null or new.km<=0 or new.km>1000 or jsonb_typeof(new.attendees) is distinct from 'array' then return new; end if;
 if tg_op='UPDATE' then if old.done is true then return new;end if;end if;
 perform pg_catalog.pg_advisory_xact_lock(76198231);
 if exists(select 1 from voltes_game.official_ride_log where ride_id=new.id) then return new;end if;
 begin
  select array_agg(distinct g.id order by g.id) into ids from voltes_game.players g join public.voltes_riders v on v.id=g.id where g.status='approved' and v.member and exists(select 1 from jsonb_array_elements_text(new.attendees) t(name) where lower(btrim(t.name))=lower(btrim(v.name)));
  people:=coalesce(cardinality(ids),0);
  if people>50 then raise exception 'more than 50 approved members';end if;
  if people>0 then
   select multiplier into mu from voltes_game.multipliers where voltes_game.multipliers.people=cardinality(ids);
   select rate into rateval from voltes_game.rates where sport='bike';
   base:=floor(round(new.km,2)*rateval)::int;rewardval:=floor(round(new.km,2)*rateval*mu)::int;
   foreach who in array ids loop
    aid:=null;
    insert into voltes_game.activities(id,player,sport,amount,day,reward,status,official_ride_id) values(gen_random_uuid(),who,'bike',round(new.km,2),new.date,rewardval,'approved',new.id) on conflict do nothing returning id into aid;
    if aid is null then
     update voltes_game.activities set status='approved',reward=rewardval,official_ride_id=new.id where player=who and sport='bike' and day=new.date and amount=round(new.km,2) and status='pending' and group_id is null and official_ride_id is null returning id into aid;
    end if;
    if aid is not null then
     update voltes_game.players set coins=coins+rewardval,xp=xp+base where id=who;
     insert into voltes_game.transactions values(aid,who,'official_ride',rewardval,now());
     credited:=credited+1;
    else skipped:=skipped+1;end if;
   end loop;
  end if;
  insert into voltes_game.official_ride_log(ride_id,status,credited,skipped,detail) values(new.id,case when skipped>0 then 'review' else 'credited' end,credited,skipped,case when skipped>0 then 'Existing activity: no duplicate credit' else null end);
 exception when others then
  insert into voltes_game.official_ride_log(ride_id,status,detail) values(new.id,'review',sqlstate) on conflict do nothing;
 end;
 return new;
end $$;
revoke all on function voltes_game.credit_official_ride() from public,anon,authenticated;
grant execute on function voltes_game.credit_official_ride() to service_role;
drop trigger if exists voltes_game_credit_completed_ride on public.voltes_rides;
create trigger voltes_game_credit_completed_ride after insert or update of done on public.voltes_rides for each row execute function voltes_game.credit_official_ride();
