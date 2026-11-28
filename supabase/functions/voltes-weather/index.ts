import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const URL=Deno.env.get("SUPABASE_URL")||"";
const ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
if(!URL||!ROLE)throw new Error("Missing Supabase credentials");
const db=createClient(URL,ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
});
const origin="https://seemsfunny21.github.io/voltes/";

type Ride={id:string;date:string;time:string|null;time_period:string|null;
  title:string|null;place:string|null;estimate:number|null;public_forecast_minutes:number|null};
type Device={device_id:string;endpoint:string;p256dh:string;auth:string};

function localClock(){
  const parts=new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/Athens",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(new Date());
  const p:Record<string,string>={};
  for(const part of parts)p[part.type]=part.value;
  return p.year+"-"+p.month+"-"+p.day+"T"+p.hour+":"+p.minute;
}
function rideWindow(r:Ride){
  const t=String(r.time||"").trim();
  const exact=/^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const period=String(r.time_period||"").toLowerCase();
  const periods:Record<string,{start:string,duration:number,label:string}>={
    morning:{start:"08:00",duration:4,label:"το πρωί"},
    noon:{start:"12:00",duration:4,label:"το μεσημέρι"},
    afternoon:{start:"16:00",duration:4,label:"το απόγευμα"}
  };
  const p=periods[period];
  if(!exact&&!p)return null; // Avoid guessing when no departure time/period exists.
  const dateTime=r.date+"T"+(exact?t:p.start)+":00Z";
  const start=Date.parse(dateTime);
  if(!Number.isFinite(start))return null;
  const estimated=Number(r.public_forecast_minutes);
  const km=Number(r.estimate);
  const duration=exact?Math.max(2,Math.min(5,
    Number.isFinite(estimated)&&estimated>0?Math.ceil(estimated/60):
    Number.isFinite(km)&&km>0?Math.ceil(km/20)+1:3)):p.duration;
  const firstHour=Math.floor(start/3600000)*3600000;
  return {start,firstHour,end:start+duration*3600000,
    when:exact?t:p.label};
}
function nextDate(date:string,addDays:number){
  const ms=Date.parse(date+"T00:00:00Z")+addDays*86400000;
  return new Date(ms).toISOString().slice(0,10);
}
async function secret(name:string){
  const {data,error}=await db.from("reminder_push_secrets").select("value").eq("name",name).single();
  if(error||!data?.value)throw error||new Error("Missing secret");
  return data.value as Record<string,unknown>;
}
let serverPromise:Promise<webpush.ApplicationServer>|null=null;
async function pushServer(){
  if(!serverPromise)serverPromise=(async()=>{
    const keys=await secret("vapid");
    const imported=await webpush.importVapidKeys(keys.exported as webpush.ExportedVapidKeys);
    return await webpush.ApplicationServer.new({contactInformation:origin,vapidKeys:imported});
  })().catch(e=>{serverPromise=null;throw e;});
  return await serverPromise;
}
function httpStatus(error:unknown){
  const e=error as {response?:{status?:number};status?:number};
  return Number(e?.response?.status||e?.status||0);
}
async function sendAll(devices:Device[],payload:Record<string,unknown>){
  const server=await pushServer();
  let sent=0,failed=0;
  for(let i=0;i<devices.length;i+=8){
    await Promise.all(devices.slice(i,i+8).map(async(d)=>{
      try{
        await (await server.subscribe({endpoint:d.endpoint,keys:{p256dh:d.p256dh,auth:d.auth}}))
          .pushTextMessage(JSON.stringify(payload),{ttl:120});
        sent++;
      }catch(e){
        failed++;
        const status=httpStatus(e);
        console.error("Voltes weather push failed",status,String(e).slice(0,160));
        if(status===404||status===410)
          await db.from("voltes_push_devices").update({enabled:false}).eq("device_id",d.device_id);
      }
    }));
  }
  return {sent,failed};
}
async function dispatch(){
  const now=localClock();
  const nowWallMs=Date.parse(now+":00Z");
  const {data:rides,error:ridesError}=await db.from("voltes_rides")
    .select("id,date,time,time_period,title,place,estimate,public_forecast_minutes")
    .eq("done",false).gte("date",now.slice(0,10))
    .lte("date",nextDate(now.slice(0,10),3)).order("date").limit(45);
  if(ridesError)throw ridesError;
  const candidates=((rides||[]) as Ride[]).map(r=>({ride:r,window:rideWindow(r)}))
    .filter((c):c is {ride:Ride;window:NonNullable<ReturnType<typeof rideWindow>>}=>{
      if(!c.window)return false;
      const lead=(c.window.start-nowWallMs)/3600000;
      return lead>0&&lead<=0.5 && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(c.ride.time||'').trim());
    });
  if(!candidates.length)return json({ok:true,checked:0,alerts:0,reason:"no upcoming timed rides"});
  const {data:devices,error:deviceError}=await db.from("voltes_push_devices")
    .select("device_id,endpoint,p256dh,auth").eq("enabled",true).limit(180);
  if(deviceError)throw deviceError;
  if(!devices?.length)return json({ok:true,checked:candidates.length,alerts:0,reason:"no subscribed devices"});
  const params=new URLSearchParams({
    latitude:"39.665",longitude:"20.8537",timezone:"Europe/Athens",
    forecast_days:"4",hourly:"precipitation_probability,precipitation"
  });
  const weatherRes=await fetch("https://api.open-meteo.com/v1/forecast?"+params.toString(),
    {signal:AbortSignal.timeout(14000),headers:{Accept:"application/json"}});
  if(!weatherRes.ok)throw new Error("Weather forecast HTTP "+weatherRes.status);
  const forecast=await weatherRes.json();
  const hours:Array<string>=forecast?.hourly?.time||[];
  const chances:Array<number|null>=forecast?.hourly?.precipitation_probability||[];
  if(!hours.length||chances.length!==hours.length)throw new Error("Incomplete hourly forecast");
  let alerts=0,delivered=0,failed=0,belowThreshold=0,duplicates=0;
  for(const {ride,window} of candidates){
    let peak=-1;
    for(let j=0;j<hours.length;j++){
      const ms=Date.parse(String(hours[j])+":00Z");
      if(ms<window.firstHour||ms>window.end)continue;
      const p=Number(chances[j]);
      if(chances[j]!==null&&Number.isFinite(p))peak=Math.max(peak,p);
    }
    if(peak<50){belowThreshold++;continue;}
    // The unique key prevents repeated warnings even if the hourly cron overlaps.
    const reserved=await db.from("voltes_weather_alerts")
      .upsert({ride_id:ride.id,ride_date:ride.date,forecast_probability:Math.round(peak),
        weather_window:window.when},{onConflict:"ride_id,ride_date",ignoreDuplicates:true})
      .select("ride_id");
    if(reserved.error)throw reserved.error;
    if(!reserved.data?.length){duplicates++;continue;}
    const title="🌧️ Προειδοποίηση βροχής για βόλτα";
    const body=String(ride.title||"Προγραμματισμένη βόλτα").slice(0,70)+
      " · "+ride.date+" "+window.when+
      " · έως "+Math.round(peak)+"% πιθανότητα βροχής στα Ιωάννινα. Δες την πρόγνωση πριν ξεκινήσεις.";
    const payload={title,body,tag:"voltes-weather-"+ride.id+"-"+ride.date,url:origin};
    try{
      const result=await sendAll(devices as Device[],payload);
      delivered+=result.sent;failed+=result.failed;
      if(result.sent>0)alerts++;
      else{
        await db.from("voltes_weather_alerts").delete().eq("ride_id",ride.id).eq("ride_date",ride.date);
      }
    }catch(e){
      await db.from("voltes_weather_alerts").delete().eq("ride_id",ride.id).eq("ride_date",ride.date);
      throw e;
    }
  }
  return json({ok:true,checked:candidates.length,alerts,delivered,failed,belowThreshold,duplicates});
}
Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"Method not allowed"},405);
  try{
    const cron=await secret("cron");
    const given=req.headers.get("X-Reminder-Cron-Secret");
    if(typeof cron.token!=="string"||!given||given!==cron.token)
      return json({ok:false,error:"Forbidden"},403);
    const action=(await req.json())?.action;
    if(action!=="dispatch")return json({ok:false,error:"Unknown action"},400);
    return await dispatch();
  }catch(error){
    console.error("Voltes weather check failed",String(error).slice(0,350));
    return json({ok:false,error:"Weather check temporarily unavailable"},500);
  }
});