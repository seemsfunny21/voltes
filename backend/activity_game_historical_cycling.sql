-- Import pre-reward completed team rides as historical cycling distance, not as retroactive currency or XP.
insert into voltes_game.activities(id,player,sport,amount,day,reward,status,official_ride_id)
select gen_random_uuid(),r.id,'bike',round(v.km,2),v.date,0,'approved',v.id
from public.voltes_riders r
join voltes_game.players g on g.id=r.id and g.status='approved'
join public.voltes_rides v on v.done and v.km>0 and exists(select 1 from jsonb_array_elements_text(v.attendees) t(name) where lower(btrim(t.name))=lower(btrim(r.name)))
where r.member
and not exists(select 1 from voltes_game.official_ride_log l where l.ride_id=v.id)
and not exists(select 1 from voltes_game.activities a where a.player=r.id and (a.official_ride_id=v.id or (a.sport='bike' and a.day=v.date and a.amount=round(v.km,2))))
on conflict do nothing;
