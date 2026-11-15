-- Additional, per-bicycle equipment and saved target tyre pressures.
-- Existing bicycles, services, and maintenance tasks remain unchanged.
ALTER TABLE public.voltes_bikes
  ADD COLUMN IF NOT EXISTS bike_details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.voltes_bikes
  DROP CONSTRAINT IF EXISTS voltes_bikes_details_shape;
ALTER TABLE public.voltes_bikes
  ADD CONSTRAINT voltes_bikes_details_shape CHECK (
    jsonb_typeof(bike_details) = 'object' AND char_length(bike_details::text) <= 6000
  );
COMMENT ON COLUMN public.voltes_bikes.bike_details IS
  'Optional editable equipment inventory and manually saved tyre pressure targets (bar), per bike. Serviced by bike-services edge function only.';
