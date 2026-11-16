-- Private manual JSON export and additive, transaction-safe restore for the cycling PWA.
-- Deliberately excludes admin PIN/session tables and all push credentials/events.
create or replace function public.voltes_backup_export()
returns jsonb language sql security invoker set search_path = '' as $f$
 select jsonb_build_object(
  'format','voltes-manual-backup',
  'version',1,
  'created_at',now(),
  'scope','group-data',
  'tables',jsonb_build_object(
      'voltes_route_templates',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.voltes_route_templates r),
      'voltes_riders',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.voltes_riders r),
      'voltes_rides',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.voltes_rides r),
      'voltes_signups',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.voltes_signups r),
      'voltes_ride_admin_notes',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.voltes_ride_admin_notes r),
      'voltes_bikes',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.voltes_bikes r),
      'voltes_bike_services',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.voltes_bike_services r),
      'voltes_bike_maintenance',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.voltes_bike_maintenance r),
      'voltes_trash',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.voltes_trash r)
  )
 );
$f$;
revoke all on function public.voltes_backup_export() from public,anon,authenticated;
grant execute on function public.voltes_backup_export() to service_role;

create or replace function public.voltes_backup_restore(p_backup jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $f$
declare
  v_tables jsonb;
  v_name text;
  v_pk text;
  v_rows jsonb;
  v_count integer;
  v_inserted jsonb := '{}'::jsonb;
  v_expected text[] := array['voltes_route_templates','voltes_riders','voltes_rides','voltes_signups','voltes_ride_admin_notes','voltes_bikes','voltes_bike_services','voltes_bike_maintenance','voltes_trash'];
begin
  if p_backup is null or jsonb_typeof(p_backup) <> 'object'
    or p_backup->>'format' <> 'voltes-manual-backup'
    or p_backup->>'version' <> '1'
    or p_backup->>'scope' <> 'group-data' then
    raise exception 'Unsupported backup format' using errcode='22023';
  end if;
  if octet_length(p_backup::text) > 5000000 then
    raise exception 'Backup exceeds the 5 MB limit' using errcode='22023';
  end if;
  v_tables := p_backup->'tables';
  if jsonb_typeof(v_tables) <> 'object' then
    raise exception 'Backup tables missing' using errcode='22023';
  end if;
  if (select count(*) from jsonb_object_keys(v_tables)) <> array_length(v_expected,1) then
    raise exception 'Backup contains missing or unknown tables' using errcode='22023';
  end if;
  foreach v_name in array v_expected loop
    v_rows := v_tables->v_name;
    if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) > 5000 then
      raise exception 'Invalid table section: %',v_name using errcode='22023';
    end if;
    v_pk := case when v_name='voltes_ride_admin_notes' then 'ride_id' else 'id' end;
    if exists(
      select 1 from jsonb_array_elements(v_rows) e
       where jsonb_typeof(e) <> 'object'
          or jsonb_typeof(e->v_pk) <> 'string'
          or (e->>v_pk) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
      raise exception 'Invalid row in table %',v_name using errcode='22023';
    end if;
  end loop;
  perform pg_advisory_xact_lock(87651234);
  -- Avoid creating fresh "new ride" Push events while inserting historical data.
  perform set_config('voltes.trash_restore','on',true);
  -- Insert missing records in dependency order. Never DELETE or overwrite newer rows.
  insert into public.voltes_route_templates select * from jsonb_populate_recordset(null::public.voltes_route_templates,v_tables->'voltes_route_templates') on conflict do nothing;
  get diagnostics v_count = row_count;
  v_inserted := v_inserted || jsonb_build_object('voltes_route_templates',v_count);
  insert into public.voltes_riders select * from jsonb_populate_recordset(null::public.voltes_riders,v_tables->'voltes_riders') on conflict do nothing;
  get diagnostics v_count = row_count;
  v_inserted := v_inserted || jsonb_build_object('voltes_riders',v_count);
  insert into public.voltes_rides select * from jsonb_populate_recordset(null::public.voltes_rides,v_tables->'voltes_rides') on conflict do nothing;
  get diagnostics v_count = row_count;
  v_inserted := v_inserted || jsonb_build_object('voltes_rides',v_count);
  insert into public.voltes_signups select * from jsonb_populate_recordset(null::public.voltes_signups,v_tables->'voltes_signups') on conflict do nothing;
  get diagnostics v_count = row_count;
  v_inserted := v_inserted || jsonb_build_object('voltes_signups',v_count);
  insert into public.voltes_ride_admin_notes select * from jsonb_populate_recordset(null::public.voltes_ride_admin_notes,v_tables->'voltes_ride_admin_notes') on conflict do nothing;
  get diagnostics v_count = row_count;
  v_inserted := v_inserted || jsonb_build_object('voltes_ride_admin_notes',v_count);
  insert into public.voltes_bikes select * from jsonb_populate_recordset(null::public.voltes_bikes,v_tables->'voltes_bikes') on conflict do nothing;
  get diagnostics v_count = row_count;
  v_inserted := v_inserted || jsonb_build_object('voltes_bikes',v_count);
  insert into public.voltes_bike_services select * from jsonb_populate_recordset(null::public.voltes_bike_services,v_tables->'voltes_bike_services') on conflict do nothing;
  get diagnostics v_count = row_count;
  v_inserted := v_inserted || jsonb_build_object('voltes_bike_services',v_count);
  insert into public.voltes_bike_maintenance select * from jsonb_populate_recordset(null::public.voltes_bike_maintenance,v_tables->'voltes_bike_maintenance') on conflict do nothing;
  get diagnostics v_count = row_count;
  v_inserted := v_inserted || jsonb_build_object('voltes_bike_maintenance',v_count);
  insert into public.voltes_trash select * from jsonb_populate_recordset(null::public.voltes_trash,v_tables->'voltes_trash') on conflict do nothing;
  get diagnostics v_count = row_count;
  v_inserted := v_inserted || jsonb_build_object('voltes_trash',v_count);
  return jsonb_build_object('ok',true,'mode','missing-only','inserted',v_inserted);
end;
$f$;
revoke all on function public.voltes_backup_restore(jsonb) from public,anon,authenticated;
grant execute on function public.voltes_backup_restore(jsonb) to service_role;
