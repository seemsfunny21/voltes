-- Match the live database: old device imports must not duplicate an existing service.
alter table public.voltes_bike_services add column if not exists import_fingerprint text;
create unique index if not exists voltes_bike_services_import_unique on public.voltes_bike_services(bike_id,import_fingerprint) where import_fingerprint is not null;
