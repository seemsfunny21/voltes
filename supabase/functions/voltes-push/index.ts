import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const PROJECT_URL = Deno.env.get("SUPABASE_URL") || "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!PROJECT_URL || !KEY) throw new Error("Missing Supabase runtime credentials");
const db = createClient(PROJECT_URL, KEY, { auth:{persistSession:false,autoRefreshToken:false} });
const ORIGIN = "https://seemsfunny21.github.io";
const CORS:Record<string,string> = {
  "Access-Control-Allow-Origin":ORIGIN,
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type",
  "Cache-Control":"no-store",
  "Vary":"Origin"
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const json = (body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...CORS,"Content-Type":"application/json; charset=utf-8"}
});
const fail = (message:string,status=400)=>json({ok:false,error:message},status);

function validEndpoint(value:unknown):value is string {
  if(typeof value!=="string" || value.length>1600)return false;
  try {
    const url=new URL(value);
    const host=url.hostname.toLowerCase();
    return url.protocol==="https:" && !url.username && !url.password &&
      (host==="fcm.googleapis.com" || host.endsWith(".push.apple.com") ||
       host.endsWith(".push.services.mozilla.com"));
  }catch{return false;}
}
function validDevice(deviceId:unknown,token:unknown): deviceId is string {
 return typeof deviceId==="string" && UUID.test(deviceId) &&
        typeof token==="string" && token.length>=35 && token.length<=200 &&
        BASE64URL.test(token);
}
async function sha256(value:string) {
 const bytes=new TextEncoder().encode(value);
 return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)))
   .map(byte=>byte.toString(16).padStart(2,"0")).join("");
}
async function getSecret(name:string):Promise<Record<string,unknown>> {
 const {data,error}=await db.from("reminder_push_secrets")
    .select("value").eq("name",name).single();
 if(error||!data?.value)throw error||new Error("Missing private key configuration");
 return data.value as Record<string,unknown>;
}
let vapidPromise:Promise<Record<string,unknown>>|null=null;
const vapid=()=>vapidPromise ||= getSecret("vapid").catch(e=>{vapidPromise=null;throw e;});
let serverPromise:Promise<webpush.ApplicationServer>|null=null;
async function applicationServer() {
 if(!serverPromise)serverPromise=(async()=>{
   const keys=await vapid();
   const imported=await webpush.importVapidKeys(keys.exported as webpush.ExportedVapidKeys);
   return await webpush.ApplicationServer.new({
     contactInformation:"https://seemsfunny21.github.io/voltes/",
     vapidKeys:imported
   });
 })().catch(e=>{serverPromise=null;throw e;});
 return serverPromise;
}
type PushDevice = {device_id:string,token_hash:string,endpoint:string,p256dh:string,auth:string,enabled:boolean,last_test_at:string|null};
async function authorised(deviceId:unknown,token:unknown):Promise<PushDevice|null> {
 if(!validDevice(deviceId,token))return null;
 const {data,error}=await db.from("voltes_push_devices").select("*").eq("device_id",deviceId).maybeSingle();
 if(error)throw error;
 if(!data || data.token_hash!==await sha256(token as string))return null;
 return data as PushDevice;
}
async function pushTo(device:Pick<PushDevice,"endpoint"|"p256dh"|"auth">, payload:Record<string,unknown>) {
 const server=await applicationServer();
 await server.subscribe({
   endpoint:device.endpoint,
   keys:{p256dh:device.p256dh,auth:device.auth}
 }).pushTextMessage(JSON.stringify(payload),{ttl:3600});
}
function errorStatus(error:unknown):number {
 const e=error as {response?:{status?:number},status?:number};
 return Number(e?.response?.status || e?.status || 0);
}
async function handleDispatch() {
 const {data:events,error}=await db.rpc("voltes_push_claim_events",{p_limit:12});
 if(error)throw error;
 if(!events?.length)return json({ok:true,claimed:0,delivered:0,failed:0});
 const {data:devices,error:devicesError}=await db.from("voltes_push_devices")
    .select("device_id,endpoint,p256dh,auth").eq("enabled",true).limit(180);
 if(devicesError)throw devicesError;
 let delivered=0,failed=0;
 for(const event of events) {
   const day=new Date(String(event.ride_date)+"T12:00:00Z");
   const date=Number.isFinite(day.getTime())
      ? new Intl.DateTimeFormat("el-GR",{timeZone:"Europe/Athens",weekday:"short",day:"numeric",month:"numeric"}).format(day)
      : String(event.ride_date);
   const period=({morning:"Πρωί",noon:"Μεσημέρι",afternoon:"Απόγευμα"} as Record<string,string>)[String(event.ride_period)] || "Ώρα κατόπιν συνεννόησης";
   const when=event.ride_time||period;
   const title=String(event.title||"Ποδηλατική βόλτα").slice(0,100);
   const place=String(event.ride_place||"").slice(0,120);
   const message=date+" · "+when+(place?" · "+place:"");
   const payload={
      title:"🚴 Νέα βόλτα: "+title,
      body:message,
      tag:"voltes-new-ride-"+String(event.ride_id),
      url:"https://seemsfunny21.github.io/voltes/"
   };
   for(let i=0;i<(devices||[]).length;i+=8) {
     const batch=(devices||[]).slice(i,i+8);
     await Promise.all(batch.map(async device=>{
       try { await pushTo(device,payload);delivered++; }
       catch(e) {
         failed++;console.error("Voltes push delivery failed",errorStatus(e),String(e).slice(0,300));
         if([404,410].includes(errorStatus(e)))
           await db.from("voltes_push_devices").update({enabled:false}).eq("device_id",device.device_id);
       }
     }));
   }
 }
 return json({ok:true,claimed:events.length,devices:(devices||[]).length,delivered,failed});
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
 const origin=req.headers.get("Origin");
 if(origin && origin!==ORIGIN)return fail("Origin not allowed",403);
 try {
   if(req.method==="GET") {
     const keys=await vapid();
     return json({ok:true,vapidPublicKey:keys.publicKey,version:1});
   }
   if(req.method!=="POST")return fail("Method not allowed",405);
   const raw=await req.text();
   if(raw.length>15000)return fail("Request too large",413);
   let payload:Record<string,unknown>;
   try { payload=JSON.parse(raw); }
   catch { return fail("Invalid JSON"); }
   if(!payload || typeof payload!=="object")return fail("Invalid request");
   if(payload.action==="dispatch") {
     const secret=await getSecret("cron");
     if(req.headers.get("X-Reminder-Cron-Secret")!==secret.token)return fail("Forbidden",403);
     return await handleDispatch();
   }
   if(!validDevice(payload.deviceId,payload.token))return fail("Invalid device credentials");
   if(payload.action==="register") {
     const sub=payload.subscription as Record<string,unknown>|null;
     const keys=sub?.keys as Record<string,unknown>|undefined;
     if(!sub || !validEndpoint(sub.endpoint) || !keys ||
       typeof keys.p256dh!=="string" || !BASE64URL.test(keys.p256dh) ||
       keys.p256dh.length<60 || keys.p256dh.length>150 ||
       typeof keys.auth!=="string" || !BASE64URL.test(keys.auth) ||
       keys.auth.length<10 || keys.auth.length>100)
        return fail("Invalid browser push subscription");
     const existing=await authorised(payload.deviceId,payload.token);
     if(!existing) {
       const {data:present,error:lookupError}=await db.from("voltes_push_devices")
          .select("device_id").eq("device_id",payload.deviceId).maybeSingle();
       if(lookupError)throw lookupError;
       if(present)return fail("Device credentials rejected",403);
       const {count,error:countError}=await db.from("voltes_push_devices").select("*",{count:"exact",head:true}).eq("enabled",true);
       if(countError)throw countError;
       if((count||0)>=180)return fail("Subscription limit reached",429);
     }
     const {error}=await db.from("voltes_push_devices").upsert({
       device_id:payload.deviceId,token_hash:await sha256(payload.token as string),
       endpoint:sub.endpoint,p256dh:keys.p256dh,auth:keys.auth,
       enabled:true,updated_at:new Date().toISOString()
     },{onConflict:"device_id"});
     if(error)throw error;
     return json({ok:true,enabled:true});
   }
   const device=await authorised(payload.deviceId,payload.token);
   if(!device)return fail("Device credentials rejected",403);
   if(payload.action==="disable") {
     const {error}=await db.from("voltes_push_devices").update({enabled:false,updated_at:new Date().toISOString()}).eq("device_id",device.device_id);
     if(error)throw error;
     return json({ok:true,enabled:false});
   }
   if(payload.action==="test") {
     if(!device.enabled)return fail("Notifications disabled",403);
     if(device.last_test_at && Date.now()-new Date(device.last_test_at).getTime()<45000)
       return fail("Περίμενε λίγο πριν από νέα δοκιμή.",429);
     const {error}=await db.from("voltes_push_devices").update({last_test_at:new Date().toISOString()}).eq("device_id",device.device_id);
     if(error)throw error;
     await pushTo(device,{
       title:"🚴 Ποδηλασία στα Ιωάννινα",
       body:"Οι ειδοποιήσεις νέας βόλτας είναι ενεργές στο κινητό σου.",
       tag:"voltes-push-test",url:"https://seemsfunny21.github.io/voltes/"
     });
     return json({ok:true,sent:true});
   }
   return fail("Unknown action",404);
 }catch(error) {
   console.error("Voltes push function",String(error));
   return fail("Temporary server error",500);
 }
});