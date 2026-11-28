-- Preserve the existing authenticated cron request. Only invoke the edge function
-- when a timed ride is within 30 minutes, there are subscribed devices and no alert was reserved.
-- Running the inexpensive database guard every minute preserves the existing 30-minute window.
do $weather$
declare j record; guard text;
begin
 select jobid,command into strict j from cron.job where jobname='voltes-weather-check-hourly';
 if position('voltes_weather_alerts a' in j.command)>0 then return;end if;
 if j.command not like '%net.http_post%' then raise exception 'Unexpected weather cron definition';end if;
 guard := $guard$
 where exists (select 1 from public.voltes_push_devices where enabled)
 and exists (
   select 1 from public.voltes_rides r
   where r.done=false and r.date between (now() at time zone 'Europe/Athens')::date and (now() at time zone 'Europe/Athens')::date+1
     and (r.date + case when btrim(r.time) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then btrim(r.time)::time end)
         > date_trunc('minute',now() at time zone 'Europe/Athens')
     and (r.date + case when btrim(r.time) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then btrim(r.time)::time end)
         <= date_trunc('minute',now() at time zone 'Europe/Athens')+interval '30 minutes'
     and not exists(select 1 from public.voltes_weather_alerts a where a.ride_id=r.id and a.ride_date=r.date)
 )$guard$;
 perform cron.alter_job(job_id=>j.jobid,command=>regexp_replace(rtrim(j.command),'[;[:space:]]+$','') || guard || ';');
end $weather$;
