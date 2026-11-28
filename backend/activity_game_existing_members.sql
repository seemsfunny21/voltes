-- One-time migration of already accepted team members. Preserve all existing accounts and balances.
insert into voltes_game.players(id,status) select id,'approved' from public.voltes_riders where member=true on conflict(id) do nothing;
