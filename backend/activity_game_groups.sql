create table if not exists voltes_game.plans(id uuid primary key,creator uuid not null references voltes_game.players(id),sport text not null check(sport in ('bike','walk','run','gym')),title text not null,place text not null,day date not null,start_time time not null,amount numeric(8,2) not null check(amount>0),duration integer not null check(duration between 1 and 1440),cancelled boolean not null default false);
create table if not exists voltes_game.plan_members(plan_id uuid references voltes_game.plans(id),player uuid references voltes_game.players(id),primary key(plan_id,player));
alter table voltes_game.plans enable row level security;
alter table voltes_game.plan_members enable row level security;
grant all on voltes_game.plans,voltes_game.plan_members to service_role;
create or replace function public.voltes_game_action(p_member uuid,p_admin boolean,p_action text,p jsonb default '{}'::jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare me voltes_game.players%rowtype; a voltes_game.activities%rowtype; item voltes_game.catalog%rowtype; r voltes_game.rates%rowtype; target uuid; rid uuid; q numeric; d date; n integer; result jsonb; msg text; today date:=(now() at time zone 'Europe/Athens')::date;
begin
 if p_admin and p_action in ('admin_state','approve_member','approve_activity','reject_activity','set_rate') then
  if p_action='approve_member' then update voltes_game.players set status='approved' where id=(p->>'target')::uuid and status='pending';
  elsif p_action in ('approve_activity','reject_activity') then
   select * into a from voltes_game.activities where id=(p->>'target')::uuid for update;
   if a.status='pending' then
    if p_action='approve_activity' then
     update voltes_game.players set coins=coins+a.reward,xp=xp+a.reward where id=a.player and status='approved';
     if not found then raise exception 'Μη εγκεκριμένο μέλος';end if;
     update voltes_game.activities set status='approved' where id=a.id;
     insert into voltes_game.transactions values(a.id,a.player,'activity',a.reward,now());
    else update voltes_game.activities set status='rejected' where id=a.id;end if;
   end if;
  elsif p_action='set_rate' then update voltes_game.rates set rate=(p->>'rate')::integer,daily_cap=(p->>'cap')::integer where sport=p->>'sport';
  end if;
  return jsonb_build_object('ok',true,'pendingMembers',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',v.name,'joined_at',g.joined_at)) from voltes_game.players g join public.voltes_riders v on v.id=g.id where g.status='pending'),'[]'::jsonb),'pendingActivities',coalesce((select jsonb_agg(to_jsonb(x)) from (select act.*,v.name from voltes_game.activities act join public.voltes_riders v on v.id=act.player where act.status='pending' order by act.created_at limit 200)x),'[]'::jsonb),'rates',(select jsonb_agg(to_jsonb(rate_row)) from voltes_game.rates rate_row));
 end if;
 if p_member is null or not exists(select 1 from public.voltes_riders where id=p_member and member) then raise exception 'Συνδέσου πρώτα';end if;
 if p_action='join' then insert into voltes_game.players(id) values(p_member) on conflict do nothing;end if;
 select * into me from voltes_game.players where id=p_member for update;
 if me.id is null or me.status<>'approved' then return jsonb_build_object('ok',true,'status',coalesce(me.status,'unregistered'));end if;
 if p_action='activity' then
  rid:=(p->>'requestId')::uuid; q:=(p->>'amount')::numeric;d:=(p->>'day')::date;
  select * into r from voltes_game.rates where sport=p->>'sport';
  if r.sport is null or q is null or q<=0 or q<>round(q,2) or d is null or d>today or d<today-7 or (r.sport='gym' and q<>trunc(q)) then raise exception 'Μη έγκυρη δραστηριότητα';end if;
  if exists(select 1 from voltes_game.activities where id=rid and player=p_member) then null;
  elsif q+coalesce((select sum(amount) from voltes_game.activities where player=p_member and sport=r.sport and day=d and status<>'rejected'),0)>r.daily_cap then raise exception 'Υπέρβαση ημερήσιου ορίου';
  else insert into voltes_game.activities(id,player,sport,amount,day,reward) values(rid,p_member,r.sport,q,d,floor(q*r.rate)::int);end if;
 elsif p_action in ('buy','gift') then
  rid:=(p->>'requestId')::uuid; target:=case when p_action='gift' then (p->>'target')::uuid else p_member end;
  select * into item from voltes_game.catalog where id=p->>'item';
  if item.id is null or target is null or not exists(select 1 from voltes_game.players where id=target and status='approved') then raise exception 'Μη διαθέσιμο αντικείμενο ή μέλος';end if;
  if exists(select 1 from voltes_game.transactions where id=rid and player=p_member) then null;
  else
   if me.coins<item.price then raise exception 'Δεν επαρκούν τα νομίσματα';end if;
   insert into voltes_game.owned(player,item) values(target,item.id);
   update voltes_game.players set coins=coins-item.price where id=p_member;
   insert into voltes_game.transactions values(rid,p_member,p_action,-item.price,now());
  end if;
 elsif p_action='plan' then
  rid:=(p->>'requestId')::uuid; q:=(p->>'amount')::numeric; d:=(p->>'day')::date;
  msg:=btrim(p->>'title');
  if p->>'sport' not in ('bike','walk','run','gym') or msg is null or char_length(msg) not between 2 and 100 or char_length(btrim(coalesce(p->>'place',''))) not between 2 and 120 or q is null or q<=0 or q>1000 or d is null or d<today or d>today+90 or (p->>'time') is null or (p->>'time') !~ '^[0-2][0-9]:[0-5][0-9]$' or (p->>'duration')::integer not between 1 and 1440 then raise exception 'Μη έγκυρος προγραμματισμός';end if;
  if (d+(p->>'time')::time) at time zone 'Europe/Athens' <= now() then raise exception 'Επίλεξε μελλοντική ώρα';end if;
  insert into voltes_game.plans(id,creator,sport,title,place,day,start_time,amount,duration) values(rid,p_member,p->>'sport',msg,btrim(p->>'place'),d,(p->>'time')::time,q,(p->>'duration')::integer) on conflict(id) do nothing;
  insert into voltes_game.plan_members(plan_id,player) select rid,p_member where exists(select 1 from voltes_game.plans where id=rid and creator=p_member) on conflict do nothing;
 elsif p_action in ('rsvp','leave_plan','cancel_plan') then
  rid:=(p->>'target')::uuid;
  if not exists(select 1 from voltes_game.plans pl where pl.id=rid and not pl.cancelled and (pl.day+pl.start_time) at time zone 'Europe/Athens' > now()) then raise exception 'Η δραστηριότητα δεν είναι διαθέσιμη';end if;
  if p_action='rsvp' then insert into voltes_game.plan_members(plan_id,player) values(rid,p_member) on conflict do nothing;
  elsif p_action='leave_plan' then delete from voltes_game.plan_members where plan_id=rid and player=p_member;
  else update voltes_game.plans set cancelled=true where id=rid and creator=p_member;if not found then raise exception 'Μόνο ο διοργανωτής μπορεί να ακυρώσει';end if;end if;
 elsif p_action='equip' then
  select * into item from voltes_game.catalog where id=p->>'item';
  if item.source_category not in ('color','frame','background','effect','title') or item.source_category is null or not exists(select 1 from voltes_game.owned own where own.player=p_member and own.item=item.id) then raise exception 'Δεν διαθέτεις αυτή την εμφάνιση';end if;
  update voltes_game.players set appearance=jsonb_set(appearance,array[item.source_category],to_jsonb(item.id),true) where id=p_member;
 elsif p_action='unequip' then
  msg:=p->>'category';if msg not in ('color','frame','background','effect','title') then raise exception 'Άγνωστη κατηγορία';end if;
  update voltes_game.players set appearance=appearance-msg where id=p_member;
 elsif p_action='style' then
  msg:=p->>'style';if msg not in ('blue','gold','green') or (msg<>'blue' and not exists(select 1 from voltes_game.owned where player=p_member and voltes_game.owned.item=msg)) then raise exception 'Δεν διαθέτεις αυτή την εμφάνιση';end if;
  update voltes_game.players set style=msg where id=p_member;
 elsif p_action='message' then
  msg:=btrim(p->>'body');target:=nullif(p->>'target','')::uuid;
  if msg is null or char_length(msg) not between 1 and 500 or (target is not null and not exists(select 1 from voltes_game.players where id=target and status='approved')) then raise exception 'Μη έγκυρο μήνυμα';end if;
  if (select count(*) from voltes_game.messages where sender=p_member and created_at>now()-interval '1 minute')>=5 then raise exception 'Περίμενε ένα λεπτό';end if;
  insert into voltes_game.messages(sender,recipient,body) values(p_member,target,msg);
 elsif p_action not in ('state','join') then raise exception 'Άγνωστη ενέργεια';
 end if;
 select * into me from voltes_game.players where id=p_member;
 return jsonb_build_object('ok',true,'status',me.status,'coins',me.coins,'xp',me.xp,'style',me.style,'appearance',me.appearance,
 'catalog',(select jsonb_agg(to_jsonb(c) order by category,price) from voltes_game.catalog c),
 'owned',coalesce((select jsonb_agg(own.item) from voltes_game.owned own where own.player=p_member),'[]'::jsonb),
 'activities',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from voltes_game.activities where player=p_member order by day desc,created_at desc limit 100)x),'[]'::jsonb),
 'totals',coalesce((select jsonb_object_agg(sport,total) from (select sport,sum(amount) total from voltes_game.activities where player=p_member and status='approved' group by sport)x),'{}'::jsonb),
 'rates',(select jsonb_agg(to_jsonb(rate_row)) from voltes_game.rates rate_row),
 'plans',coalesce((select jsonb_agg(to_jsonb(plx) order by plx.day,plx.start_time) from (select pl.*,v.name organizer,coalesce((select jsonb_agg(jsonb_build_object('id',pm.player,'name',pv.name)) from voltes_game.plan_members pm join public.voltes_riders pv on pv.id=pm.player where pm.plan_id=pl.id),'[]'::jsonb) participants from voltes_game.plans pl join public.voltes_riders v on v.id=pl.creator where not pl.cancelled and pl.day>=today order by pl.day,pl.start_time limit 100)plx),'[]'::jsonb),
 'members',coalesce((select jsonb_agg(to_jsonb(x) order by x.xp desc,x.name) from (select g.id,v.name,g.coins,g.xp,g.style,g.appearance,coalesce((select jsonb_object_agg(period_name,sport_totals) from (select periods.period_name,coalesce((select jsonb_object_agg(st.sport,st.total) from (select ga.sport,sum(ga.amount) total from voltes_game.activities ga where ga.player=g.id and ga.status='approved' and ga.day>=periods.from_day group by ga.sport)st),'{}'::jsonb) sport_totals from (values ('day',today),('week',date_trunc('week',today)::date),('month',date_trunc('month',today)::date),('year',date_trunc('year',today)::date)) periods(period_name,from_day))pr),'{}'::jsonb) period_totals,coalesce((select jsonb_agg(o.item) from voltes_game.owned o where o.player=g.id),'[]'::jsonb) owned,coalesce((select jsonb_object_agg(sport,total) from (select sport,sum(amount) total from voltes_game.activities where player=g.id and status='approved' group by sport)t),'{}'::jsonb) totals from voltes_game.players g join public.voltes_riders v on v.id=g.id where g.status='approved')x),'[]'::jsonb),
 'messages',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select m.id,m.sender,m.recipient,m.body,m.created_at,v.name from voltes_game.messages m join public.voltes_riders v on v.id=m.sender where m.recipient is null or m.recipient=p_member or m.sender=p_member order by m.id desc limit 100)x),'[]'::jsonb));
end $$;
revoke all on function public.voltes_game_action(uuid,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.voltes_game_action(uuid,boolean,text,jsonb) to service_role;
