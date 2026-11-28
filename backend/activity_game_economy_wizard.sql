create table if not exists voltes_game.economy_settings(singleton boolean primary key default true check(singleton),revision bigint not null default 0);
insert into voltes_game.economy_settings(singleton) values(true) on conflict do nothing;
alter table voltes_game.economy_settings enable row level security;
revoke all on table voltes_game.economy_settings from public,anon,authenticated;
grant select,update on table voltes_game.economy_settings to service_role;
CREATE OR REPLACE FUNCTION public.voltes_game_action(p_member uuid, p_admin boolean, p_action text, p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare me voltes_game.players%rowtype; a voltes_game.activities%rowtype; item voltes_game.catalog%rowtype; r voltes_game.rates%rowtype; target uuid; rid uuid; q numeric; d date; n integer; group_row voltes_game.group_entries%rowtype; ids uuid[]; who uuid; bonus numeric; result jsonb; msg text; today date:=(now() at time zone 'Europe/Athens')::date;
begin
 perform pg_catalog.pg_advisory_xact_lock(76198231);
 if p_admin and p_action in ('admin_state','approve_member','approve_activity','reject_activity','set_rate','approve_group','reject_group','set_multiplier','set_price') then
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
  elsif p_action in ('approve_group','reject_group') then
   rid:=(p->>'target')::uuid;select * into group_row from voltes_game.group_entries where id=rid for update;
   if group_row.status='pending' then
    if p_action='reject_group' then update voltes_game.group_entries set status='rejected' where id=rid;
    else
     if exists(select 1 from voltes_game.group_people gp where gp.group_id=rid and gp.status='invited') then raise exception 'Αναμένονται επιβεβαιώσεις';end if;
     select array_agg(gp.player order by gp.player) into ids from voltes_game.group_people gp where gp.group_id=rid and gp.status='confirmed';
     n:=coalesce(cardinality(ids),0);if n=0 then raise exception 'Δεν υπάρχουν συμμετέχοντες';end if;
     select * into r from voltes_game.rates where sport=group_row.sport;
     select multiplier into bonus from voltes_game.multipliers where people=n;
     foreach who in array ids loop
      if not exists(select 1 from voltes_game.players where id=who and status='approved') then raise exception 'Μη εγκεκριμένο μέλος';end if;
      if group_row.amount+coalesce((select sum(amount) from voltes_game.activities where player=who and sport=group_row.sport and day=group_row.day and status<>'rejected'),0)>r.daily_cap then raise exception 'Υπέρβαση ημερήσιου ορίου συμμετέχοντα';end if;
      insert into voltes_game.activities(id,player,sport,amount,day,reward,status,group_id) values(gen_random_uuid(),who,group_row.sport,group_row.amount,group_row.day,floor(group_row.amount*group_row.rate*bonus)::int,'approved',rid) returning * into a;
      update voltes_game.players set coins=coins+a.reward,xp=xp+floor(group_row.amount*group_row.rate)::int where id=who;
      insert into voltes_game.transactions values(a.id,who,'group_activity',a.reward,now());
     end loop;
     update voltes_game.group_entries set status='approved',multiplier=bonus where id=rid;
    end if;
   end if;
  elsif p_action='set_multiplier' then update voltes_game.multipliers set multiplier=(p->>'multiplier')::numeric where people=(p->>'people')::integer;
  elsif p_action='set_price' then update voltes_game.catalog set price=(p->>'price')::integer where id=p->>'item';
  elsif p_action='set_rate' then update voltes_game.rates set rate=(p->>'rate')::integer,daily_cap=(p->>'cap')::integer where sport=p->>'sport';
  end if;
  return jsonb_build_object('ok',true,'multipliers',(select jsonb_agg(to_jsonb(mu) order by mu.people) from voltes_game.multipliers mu),'catalog',(select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'price',c.price) order by c.name) from voltes_game.catalog c),'pendingGroups',coalesce((select jsonb_agg(jsonb_build_object('id',ge.id,'name',v.name,'sport',ge.sport,'amount',ge.amount,'day',ge.day,'people',(select count(*) from voltes_game.group_people gp where gp.group_id=ge.id and gp.status='confirmed'),'waiting',(select count(*) from voltes_game.group_people gp where gp.group_id=ge.id and gp.status='invited'))) from voltes_game.group_entries ge join public.voltes_riders v on v.id=ge.creator where ge.status='pending'),'[]'::jsonb),'pendingMembers',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',v.name,'joined_at',g.joined_at)) from voltes_game.players g join public.voltes_riders v on v.id=g.id where g.status='pending'),'[]'::jsonb),'pendingActivities',coalesce((select jsonb_agg(to_jsonb(x)) from (select act.*,v.name from voltes_game.activities act join public.voltes_riders v on v.id=act.player where act.status='pending' order by act.created_at limit 200)x),'[]'::jsonb),'rates',(select jsonb_agg(to_jsonb(rate_row)) from voltes_game.rates rate_row));
 end if;
 if p_member is null or not exists(select 1 from public.voltes_riders where id=p_member and member) then raise exception 'Συνδέσου πρώτα';end if;
 if p_action='join' then insert into voltes_game.players(id) values(p_member) on conflict do nothing;end if;
 select * into me from voltes_game.players where id=p_member for update;
 if me.id is null or me.status<>'approved' then return jsonb_build_object('ok',true,'status',coalesce(me.status,'unregistered'));end if;
 if p_action='group_activity' then
  rid:=(p->>'requestId')::uuid;q:=(p->>'amount')::numeric;d:=(p->>'day')::date;
  select * into r from voltes_game.rates where sport=p->>'sport';
  if r.sport is null or q is null or q<=0 or q>r.daily_cap or q<>round(q,2) or d is null or d>today or d<today-7 or (r.sport='gym' and q<>trunc(q)) then raise exception 'Μη έγκυρη δραστηριότητα';end if;
  if jsonb_typeof(p->'participants') is distinct from 'array' or jsonb_array_length(p->'participants')>49 then raise exception 'Μέχρι 50 συμμετέχοντες';end if;
  select array_agg(distinct v order by v) into ids from (select p_member v union all select value::uuid from jsonb_array_elements_text(p->'participants')) z;
  n:=cardinality(ids);if n<2 or n>50 then raise exception 'Επίλεξε 2 έως 50 μέλη';end if;
  if not exists(select 1 from voltes_game.group_entries where id=rid and creator=p_member) then
   if exists(select 1 from unnest(ids) u(id) where not exists(select 1 from voltes_game.players where id=u.id and status='approved')) then raise exception 'Μη εγκεκριμένο μέλος';end if;
   if exists(select 1 from voltes_game.group_entries ge where ge.creator=p_member and ge.sport=r.sport and ge.day=d and ge.amount=q and ge.status<>'rejected') then raise exception 'Η δραστηριότητα έχει ήδη καταχωριστεί';end if;
   insert into voltes_game.group_entries(id,creator,sport,amount,day,rate) values(rid,p_member,r.sport,q,d,r.rate);
   insert into voltes_game.group_people(group_id,player,status) select rid,uid,case when uid=p_member then 'confirmed' else 'invited' end from unnest(ids) uid;
  end if;
 elsif p_action in ('confirm_group','decline_group') then
  rid:=(p->>'target')::uuid;
  update voltes_game.group_people set status=case when p_action='confirm_group' then 'confirmed' else 'declined' end where group_id=rid and player=p_member and status='invited' and exists(select 1 from voltes_game.group_entries ge where ge.id=rid and ge.status='pending');
 elsif p_action='activity' then
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
   if ((p->>'expectedPrice') is null and (select revision from voltes_game.economy_settings where singleton)>0) or ((p->>'expectedPrice') is not null and (p->>'expectedPrice')::integer is distinct from item.price) then raise exception 'Η τιμή ενημερώθηκε. Ανανέωσε το κατάστημα.';end if;
   if me.coins<item.price then raise exception 'Δεν επαρκούν τα νομίσματα';end if;
   if p_action='gift' then
    if target=p_member then raise exception 'Επίλεξε άλλο μέλος';end if;
    insert into voltes_game.gifts(id,sender,recipient,item,visible) values(rid,p_member,target,item.id,coalesce((p->>'visible')::boolean,false));
    if item.source_category is distinct from 'gift' then
     insert into voltes_game.owned(player,item,private_gift) values(target,item.id,not coalesce((p->>'visible')::boolean,false));
    end if;
   else insert into voltes_game.owned(player,item) values(target,item.id);end if;
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
 'multipliers',(select jsonb_agg(to_jsonb(mu) order by mu.people) from voltes_game.multipliers mu),
 'groups',coalesce((select jsonb_agg(to_jsonb(gg)) from (select ge.*,gp.status my_status,v.name organizer,(select count(*) from voltes_game.group_people p2 where p2.group_id=ge.id and p2.status='confirmed') confirmed,(select count(*) from voltes_game.group_people p2 where p2.group_id=ge.id and p2.status<>'declined') expected from voltes_game.group_entries ge join voltes_game.group_people gp on gp.group_id=ge.id join public.voltes_riders v on v.id=ge.creator where gp.player=p_member order by ge.created_at desc limit 100)gg),'[]'::jsonb),
 'gifts',coalesce((select jsonb_agg(jsonb_build_object('id',gf.id,'item',gf.item,'sender',v.name,'visible',gf.visible,'created_at',gf.created_at) order by gf.created_at desc) from voltes_game.gifts gf join public.voltes_riders v on v.id=gf.sender where gf.recipient=p_member),'[]'::jsonb),
 'catalog',(select jsonb_agg(to_jsonb(c) order by category,price) from voltes_game.catalog c),
 'owned',coalesce((select jsonb_agg(own.item) from voltes_game.owned own where own.player=p_member),'[]'::jsonb),
 'activities',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from voltes_game.activities where player=p_member order by day desc,created_at desc limit 100)x),'[]'::jsonb),
 'totals',coalesce((select jsonb_object_agg(sport,total) from (select sport,sum(amount) total from voltes_game.activities where player=p_member and status='approved' group by sport)x),'{}'::jsonb),
 'rates',(select jsonb_agg(to_jsonb(rate_row)) from voltes_game.rates rate_row),
 'plans',coalesce((select jsonb_agg(to_jsonb(plx) order by plx.day,plx.start_time) from (select pl.*,v.name organizer,coalesce((select jsonb_agg(jsonb_build_object('id',pm.player,'name',pv.name)) from voltes_game.plan_members pm join public.voltes_riders pv on pv.id=pm.player where pm.plan_id=pl.id),'[]'::jsonb) participants from voltes_game.plans pl join public.voltes_riders v on v.id=pl.creator where not pl.cancelled and pl.day>=today order by pl.day,pl.start_time limit 100)plx),'[]'::jsonb),
 'members',coalesce((select jsonb_agg(to_jsonb(x) order by x.xp desc,x.name) from (select g.id,v.name,g.coins,g.xp,g.style,g.appearance,coalesce((select jsonb_agg(jsonb_build_object('id',gf.id,'item',gf.item,'sender',sv.name,'visible',gf.visible,'created_at',gf.created_at) order by gf.created_at desc) from voltes_game.gifts gf join public.voltes_riders sv on sv.id=gf.sender where gf.recipient=g.id and gf.visible),'[]'::jsonb) gifts,coalesce((select jsonb_object_agg(period_name,sport_totals) from (select periods.period_name,coalesce((select jsonb_object_agg(st.sport,st.total) from (select ga.sport,sum(ga.amount) total from voltes_game.activities ga where ga.player=g.id and ga.status='approved' and ga.day>=periods.from_day group by ga.sport)st),'{}'::jsonb) sport_totals from (values ('day',today),('week',date_trunc('week',today)::date),('month',date_trunc('month',today)::date),('year',date_trunc('year',today)::date)) periods(period_name,from_day))pr),'{}'::jsonb) period_totals,coalesce((select jsonb_agg(o.item) from voltes_game.owned o where o.player=g.id and (not o.private_gift or g.id=p_member)),'[]'::jsonb) owned,coalesce((select jsonb_object_agg(sport,total) from (select sport,sum(amount) total from voltes_game.activities where player=g.id and status='approved' group by sport)t),'{}'::jsonb) totals from voltes_game.players g join public.voltes_riders v on v.id=g.id where g.status='approved')x),'[]'::jsonb),
 'messages',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select m.id,m.sender,m.recipient,m.body,m.created_at,v.name from voltes_game.messages m join public.voltes_riders v on v.id=m.sender where m.recipient is null or m.recipient=p_member or m.sender=p_member order by m.id desc limit 100)x),'[]'::jsonb));
end $function$
;
create or replace function public.voltes_game_economy_plan(p_admin boolean,p_reward numeric default 1,p_pace numeric default 1,p_apply boolean default false,p_expected text default null)
returns jsonb language plpgsql set search_path to '' as $plan$
declare fingerprint text; rates jsonb; products jsonb; samples jsonb; old_total bigint; new_total bigint; item_count integer; sample_members integer; typical numeric; rev bigint;
begin
 if p_admin is not true then raise exception 'Απαιτείται Admin.';end if;
 if p_reward is null or p_reward not between .5 and 3 or p_reward<>round(p_reward,2) or p_pace is null or p_pace not between 1 and 3 or p_pace<>round(p_pace,2) then raise exception 'Μη έγκυρο πλάνο.';end if;
 perform pg_advisory_xact_lock(76198231);
 select revision into strict rev from voltes_game.economy_settings where singleton for update;
 select md5(jsonb_build_array(rev,(select jsonb_agg(to_jsonb(r) order by sport) from voltes_game.rates r),(select jsonb_agg(jsonb_build_array(id,price) order by id) from voltes_game.catalog))::text) into fingerprint;
 select jsonb_agg(jsonb_build_object('sport',sport,'old_rate',rate,'new_rate',greatest(1,round(rate*p_reward))::integer,'daily_cap',daily_cap) order by sport) into rates from voltes_game.rates;
 with p as (select id,name,price old_price,greatest(1,round(price*p_reward*p_pace))::bigint new_price from voltes_game.catalog)
 select coalesce(jsonb_agg(to_jsonb(p) order by old_price,id),'[]'),coalesce(sum(old_price),0),coalesce(sum(new_price),0),count(*) into products,old_total,new_total,item_count from p;
 if exists(select 1 from jsonb_to_recordset(rates) as x(new_rate integer) where new_rate>1000) or exists(select 1 from jsonb_to_recordset(products) as x(new_price bigint) where new_price>1000000) then raise exception 'Το πλάνο υπερβαίνει τα επιτρεπόμενα όρια.';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by old_price,id),'[]') into samples from (select * from (select * from jsonb_to_recordset(products) as j(id text,name text,old_price integer,new_price bigint) order by old_price,id limit 4)a union all select * from (select * from jsonb_to_recordset(products) as j(id text,name text,old_price integer,new_price bigint) order by old_price desc,id limit 4)b)x;
 select count(*),coalesce(round((percentile_cont(.5) within group(order by earned))::numeric/4),0) into sample_members,typical from (select player,sum(reward) earned from voltes_game.activities where status='approved' and day>=(now() at time zone 'Europe/Athens')::date-27 group by player)t;
 if p_apply then
  if p_expected is distinct from fingerprint then raise exception 'Το πλάνο άλλαξε. Κάνε νέα προεπισκόπηση.';end if;
  if p_reward<>1 or p_pace<>1 then
   update voltes_game.rates r set rate=v.new_rate from jsonb_to_recordset(rates) as v(sport text,new_rate integer) where r.sport=v.sport;
   update voltes_game.catalog c set price=v.new_price::integer from jsonb_to_recordset(products) as v(id text,new_price bigint) where c.id=v.id;
   update voltes_game.economy_settings set revision=revision+1 where singleton;
  end if;
 end if;
 return jsonb_build_object('ok',true,'fingerprint',fingerprint,'reward',p_reward,'pace',p_pace,'rates',rates,'samples',samples,'item_count',item_count,'old_total',old_total,'new_total',new_total,'sample_members',sample_members,'median_weekly_earned',typical,'applied',p_apply);
end $plan$;
revoke all on function public.voltes_game_economy_plan(boolean,numeric,numeric,boolean,text) from public,anon,authenticated;
grant execute on function public.voltes_game_economy_plan(boolean,numeric,numeric,boolean,text) to service_role;
