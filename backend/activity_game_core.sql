
create schema if not exists voltes_game;
revoke all on schema voltes_game from public,anon,authenticated;
grant usage on schema voltes_game to service_role;
create table if not exists voltes_game.players(id uuid primary key references public.voltes_riders(id), status text not null default 'pending' check(status in ('pending','approved')), coins bigint not null default 1000 check(coins>=0), xp bigint not null default 0, joined_at timestamptz not null default now(), style text not null default 'blue');
create table if not exists voltes_game.activities(id uuid primary key, player uuid not null references voltes_game.players(id), sport text not null check(sport in ('bike','walk','run','gym')), amount numeric(8,2) not null check(amount>0), day date not null, reward integer not null check(reward>=0), status text not null default 'pending' check(status in ('pending','approved','rejected')), created_at timestamptz default now(), unique(player,sport,day,amount));
create table if not exists voltes_game.catalog(id text primary key, category text not null, name text not null, icon text not null, price integer not null check(price>0));
insert into voltes_game.catalog values
('bike_basic','Ποδήλατο','Ποδήλατο δρόμου','🚲',1500),('bike_pro','Ποδήλατο','Carbon ποδήλατο','🚴',8000),('helmet','Εξοπλισμός','Κράνος','⛑️',400),('shoes','Εξοπλισμός','Αθλητικά παπούτσια','👟',700),('home','Σπίτι','Μικρό σπίτι','🏠',5000),('villa','Σπίτι','Βίλα','🏡',25000),('car','Αυτοκίνητο','Αυτοκίνητο','🚗',12000),('motor','Μηχανή','Μοτοσυκλέτα','🏍️',6000),('dog','Κατοικίδιο','Σκύλος','🐕',1200),('cat','Κατοικίδιο','Γάτα','🐈',1000),('parrot','Κατοικίδιο','Παπαγάλος','🦜',1400),('phone','Κινητό','Smartphone','📱',1800),('watch','Ρολόι','Αθλητικό ρολόι','⌚',1200),('laptop','Τεχνολογία','Laptop','💻',3500),('trip','Ταξίδια','Ταξίδι','✈️',4500),('gold','Εμφάνιση','Χρυσό προφίλ','✨',1500),('green','Εμφάνιση','Πράσινο προφίλ','🌿',500)
on conflict(id) do nothing;
create table if not exists voltes_game.owned(player uuid references voltes_game.players(id), item text references voltes_game.catalog(id), acquired_at timestamptz default now(), primary key(player,item));
create table if not exists voltes_game.messages(id bigint generated always as identity primary key, sender uuid not null references voltes_game.players(id), recipient uuid references voltes_game.players(id), body text not null check(char_length(body) between 1 and 500), created_at timestamptz default now());
create table if not exists voltes_game.rates(sport text primary key, rate integer not null check(rate between 1 and 1000), daily_cap integer not null check(daily_cap between 1 and 1000));
insert into voltes_game.rates values ('bike',10,200),('walk',20,30),('run',30,50),('gym',10,180) on conflict do nothing;
create table if not exists voltes_game.transactions(id uuid primary key, player uuid references voltes_game.players(id), kind text not null, amount bigint not null, created_at timestamptz default now());
alter table voltes_game.players enable row level security;
alter table voltes_game.activities enable row level security;
alter table voltes_game.catalog enable row level security;
alter table voltes_game.owned enable row level security;
alter table voltes_game.messages enable row level security;
alter table voltes_game.rates enable row level security;
alter table voltes_game.transactions enable row level security;
grant all on all tables in schema voltes_game to service_role;
grant usage,select on all sequences in schema voltes_game to service_role;
insert into voltes_game.players(id,status) select c.member_id,'approved' from public.voltes_member_credentials c join public.voltes_riders r on r.id=c.member_id and r.member on conflict do nothing;
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
 return jsonb_build_object('ok',true,'status',me.status,'coins',me.coins,'xp',me.xp,'style',me.style,
 'catalog',(select jsonb_agg(to_jsonb(c) order by category,price) from voltes_game.catalog c),
 'owned',coalesce((select jsonb_agg(own.item) from voltes_game.owned own where own.player=p_member),'[]'::jsonb),
 'activities',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from voltes_game.activities where player=p_member order by day desc,created_at desc limit 100)x),'[]'::jsonb),
 'totals',coalesce((select jsonb_object_agg(sport,total) from (select sport,sum(amount) total from voltes_game.activities where player=p_member and status='approved' group by sport)x),'{}'::jsonb),
 'rates',(select jsonb_agg(to_jsonb(rate_row)) from voltes_game.rates rate_row),
 'members',coalesce((select jsonb_agg(to_jsonb(x) order by x.xp desc,x.name) from (select g.id,v.name,g.coins,g.xp,g.style,coalesce((select jsonb_agg(o.item) from voltes_game.owned o where o.player=g.id),'[]'::jsonb) owned,coalesce((select jsonb_object_agg(sport,total) from (select sport,sum(amount) total from voltes_game.activities where player=g.id and status='approved' group by sport)t),'{}'::jsonb) totals from voltes_game.players g join public.voltes_riders v on v.id=g.id where g.status='approved')x),'[]'::jsonb),
 'messages',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select m.id,m.sender,m.recipient,m.body,m.created_at,v.name from voltes_game.messages m join public.voltes_riders v on v.id=m.sender where m.recipient is null or m.recipient=p_member or m.sender=p_member order by m.id desc limit 100)x),'[]'::jsonb));
end $$;
revoke all on function public.voltes_game_action(uuid,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.voltes_game_action(uuid,boolean,text,jsonb) to service_role;
