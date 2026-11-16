
-- Private 30-day recovery bin for the cycling group. Never exposed through the public client.
create table if not exists public.voltes_trash (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('ride','rider','maintenance','service','route')),
  entity_id uuid not null,
  label text not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  deleted_at timestamptz not null default now(),
  restored_at timestamptz
);
create index if not exists voltes_trash_unrestored_date_idx on public.voltes_trash(deleted_at desc) where restored_at is null;
alter table public.voltes_trash enable row level security;
revoke all privileges on public.voltes_trash from public, anon, authenticated;
grant select, insert, update, delete on public.voltes_trash to service_role;

create or replace function public.voltes_archive_deleted()
returns trigger language plpgsql set search_path = '' as $f$
declare
 v_kind text;
 v_label text;
 v_snapshot jsonb;
 v_signups jsonb;
 v_notes jsonb;
 v_row jsonb;
begin
 if tg_op = 'UPDATE' then
   if tg_table_name <> 'voltes_bike_services' or old.deleted_at is not null or new.deleted_at is null then
     return new;
   end if;
   v_kind := 'service';
   v_label := old.work;
   v_snapshot := jsonb_build_object('record',to_jsonb(new));
 else
   v_row := to_jsonb(old);
   if tg_table_name = 'voltes_rides' then
     v_kind := 'ride';
     v_label := old.title || ' · ' || old.date::text;
     select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_signups
       from public.voltes_signups s where s.ride_id = old.id;
     select to_jsonb(n) into v_notes
       from public.voltes_ride_admin_notes n where n.ride_id = old.id;
     v_snapshot := jsonb_build_object('record',v_row,'signups',v_signups,'notes',v_notes);
   elsif tg_table_name = 'voltes_riders' then
     v_kind := 'rider';
     v_label := old.name;
     v_snapshot := jsonb_build_object('record',v_row);
   elsif tg_table_name = 'voltes_bike_maintenance' then
     v_kind := 'maintenance';
     v_label := old.label;
     v_snapshot := jsonb_build_object('record',v_row);
   elsif tg_table_name = 'voltes_route_templates' then
     v_kind := 'route';
     v_label := old.name;
     v_snapshot := jsonb_build_object('record',v_row);
   else
     return old;
   end if;
 end if;
 insert into public.voltes_trash(kind,entity_id,label,snapshot)
 values(v_kind,old.id,v_label,v_snapshot);
 if tg_op = 'UPDATE' then return new; end if;
 return old;
end;
$f$;
revoke execute on function public.voltes_archive_deleted() from public, anon, authenticated;

create trigger voltes_trash_ride before delete on public.voltes_rides
  for each row execute function public.voltes_archive_deleted();
create trigger voltes_trash_rider before delete on public.voltes_riders
  for each row execute function public.voltes_archive_deleted();
create trigger voltes_trash_maintenance before delete on public.voltes_bike_maintenance
  for each row execute function public.voltes_archive_deleted();
create trigger voltes_trash_route before delete on public.voltes_route_templates
  for each row execute function public.voltes_archive_deleted();
create trigger voltes_trash_service after update of deleted_at on public.voltes_bike_services
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.voltes_archive_deleted();

-- Restoring a scheduled ride must NEVER be mistaken for publishing a new ride.
create or replace function public.voltes_queue_new_ride_push()
returns trigger language plpgsql set search_path = '' as $f$
begin
 if current_setting('voltes.trash_restore', true) = 'on' then return new; end if;
 if new.done is false
    and new.date >= ((now() at time zone 'Europe/Athens')::date) then
   insert into public.voltes_push_events(ride_id) values (new.id) on conflict do nothing;
 end if;
 return new;
end;
$f$;

-- Atomic per-item restoration. Callable exclusively using the server-side service key.
create or replace function public.voltes_restore_from_trash(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $f$
declare
  v public.voltes_trash%rowtype;
  n integer;
begin
 select * into v from public.voltes_trash
 where id = p_id and restored_at is null
   and deleted_at >= now() - interval '30 days'
 for update;
 if not found then
   raise exception 'Trash item not found or expired' using errcode = 'P0002';
 end if;
 perform set_config('voltes.trash_restore', 'on', true);
 if v.kind = 'ride' then
   insert into public.voltes_rides
   select * from jsonb_populate_record(null::public.voltes_rides,v.snapshot->'record');
   insert into public.voltes_signups
   select * from jsonb_populate_recordset(null::public.voltes_signups,coalesce(v.snapshot->'signups','[]'::jsonb));
   if jsonb_typeof(v.snapshot->'notes') = 'object' then
     insert into public.voltes_ride_admin_notes
     select * from jsonb_populate_record(null::public.voltes_ride_admin_notes,v.snapshot->'notes');
   end if;
 elsif v.kind = 'rider' then
   insert into public.voltes_riders
   select * from jsonb_populate_record(null::public.voltes_riders,v.snapshot->'record');
 elsif v.kind = 'maintenance' then
   insert into public.voltes_bike_maintenance
   select * from jsonb_populate_record(null::public.voltes_bike_maintenance,v.snapshot->'record');
 elsif v.kind = 'route' then
   insert into public.voltes_route_templates
   select * from jsonb_populate_record(null::public.voltes_route_templates,v.snapshot->'record');
 elsif v.kind = 'service' then
   update public.voltes_bike_services set deleted_at = null
    where id = v.entity_id and deleted_at is not null;
   get diagnostics n = row_count;
   if n <> 1 then raise exception 'Service no longer recoverable' using errcode = 'P0002'; end if;
 else
   raise exception 'Unknown trash kind' using errcode = 'P0002';
 end if;
 update public.voltes_trash set restored_at=now() where id=v.id;
 return jsonb_build_object('ok',true,'kind',v.kind,'label',v.label);
end;
$f$;
revoke all on function public.voltes_restore_from_trash(uuid) from public, anon, authenticated;
grant execute on function public.voltes_restore_from_trash(uuid) to service_role;

-- Automatic pruning; the bin and soft-deleted service rows expire after 30 days.
select cron.schedule(
 'voltes-trash-purge-daily',
 '20 2 * * *',
 $job$delete from public.voltes_trash where deleted_at < now()-interval '30 days';
       delete from public.voltes_bike_services where deleted_at < now()-interval '30 days';$job$
);
