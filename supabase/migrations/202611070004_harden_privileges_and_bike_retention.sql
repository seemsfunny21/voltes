-- Protect internal trigger RPC and service records without changing frontend permissions.
revoke execute on function public.voltes_register_completed_ride_visitors() from public,anon,authenticated;
create index if not exists voltes_rides_route_template_idx on public.voltes_rides(route_template_id) where route_template_id is not null;
alter table public.voltes_bikes drop constraint if exists voltes_bikes_member_id_fkey;
alter table public.voltes_bikes add constraint voltes_bikes_member_id_fkey foreign key(member_id) references public.voltes_riders(id) on delete restrict;
