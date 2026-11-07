-- Keep small deletion markers so an old device never re-imports a deleted service.
alter table public.voltes_bike_services add column if not exists deleted_at timestamptz;
create index if not exists voltes_bike_services_active_idx on public.voltes_bike_services(bike_id,service_date desc) where deleted_at is null;
