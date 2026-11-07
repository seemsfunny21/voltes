import { createClient } from 'npm:@supabase/supabase-js@2';
import '../_shared/completion.js';
const {validateCompletion,formatMovingTime}=(globalThis as unknown as {VoltesCompletion:{validateCompletion:(input:any)=>any;formatMovingTime:(minutes:number)=>string}}).VoltesCompletion;
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const weatherCache=new Map<string,{value:any,at:number}>();
let weatherHourlyCache:{data:any,at:number,pending:Promise<any>|null}={data:null,at:0,pending:null};
async function getWeatherHourly(){
 if(weatherHourlyCache.data&&Date.now()-weatherHourlyCache.at<3600000)return weatherHourlyCache.data;
 if(weatherHourlyCache.pending)return weatherHourlyCache.pending;
 const url='https://api.open-meteo.com/v1/forecast?latitude=39.667&longitude=20.850&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m&timezone=Europe%2FAthens&forecast_days=7';
 weatherHourlyCache.pending=(async()=>{const response=await fetch(url,{signal:AbortSignal.timeout(6500)});
  if(!response.ok)throw Error('weather unavailable');
  const hourly=(await response.json()).hourly;
  weatherHourlyCache.data=hourly;weatherHourlyCache.at=Date.now();return hourly;
 })().finally(()=>{weatherHourlyCache.pending=null});
 return weatherHourlyCache.pending;
}
const weatherFor=async(r:any)=>{
 const key=String(r.id)+'|'+r.date+'|'+r.time;
 const cached=weatherCache.get(key);
 if(cached&&Date.now()-cached.at<3600000)return cached.value;
 try{
  const h=await getWeatherHourly();
  const idx=(h?.time||[]).indexOf(String(r.date)+'T'+String(r.time||'10:00').slice(0,2)+':00');
  if(idx<0)return cached?.value||null;
  const value={temperature:h.temperature_2m[idx],code:h.weather_code[idx],rain:h.precipitation_probability[idx],wind:h.wind_speed_10m[idx],direction:h.wind_direction_10m[idx],gust:h.wind_gusts_10m[idx],updatedAt:new Date().toISOString()};
  weatherCache.set(key,{value,at:Date.now()});
  if(weatherCache.size>100){const first=weatherCache.keys().next().value;if(first)weatherCache.delete(first)}
  return value;
 }catch{return cached?.value||null}
};
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const secret=Deno.env.get('ADMIN_PIN');
const norm=(s:unknown,max=100)=>String(s??'').trim().slice(0,max);
const validPin=(p:unknown)=>Boolean(secret)&&typeof p==='string'&&/^\d{4}$/.test(p)&&p===secret;
const bad=(msg='Μη έγκυρα δεδομένα',status=400)=>reply({error:msg},status);
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const tokenValid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const pinVersion=()=>digest((Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'')+':'+secret);
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return bad('Method not allowed',405);
 let payload;
 try{payload=await req.json()}catch{return bad()}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return bad();
 try{
 const action=norm(payload.action,40);
 let admin=false; // PIN used only for rate-limited login, not on every API request.
 const sessionHash=tokenValid(payload.adminToken)?await digest(payload.adminToken):null;
 if(!admin&&sessionHash){const {data,error}=await db.from('voltes_admin_sessions').select('pin_version').eq('token_hash',sessionHash).maybeSingle();if(error)throw error;admin=!!data&&data.pin_version===await pinVersion()}
 if(!['state','signup','cancelSignup','login','logout'].includes(action)&&!admin)return bad('Απαιτείται PIN διαχειριστή',403);
 if(action==='logout'){if(sessionHash){const {error}=await db.from('voltes_admin_sessions').delete().eq('token_hash',sessionHash);if(error)throw error}return reply({ok:true})}
 if(action==='login'){
  const clientIp=String(req.headers.get('x-real-ip')||req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim().slice(0,120);
  const loginKey=await digest('voltes-admin-login:'+clientIp+':'+(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''));
  const gate=await db.rpc('voltes_admin_login_gate',{p_key:loginKey,p_correct:validPin(payload.pin)});
  if(gate.error)throw gate.error;
  if(gate.data!==true)return bad('Λάθος PIN ή υπέρβαση προσπαθειών. Δοκίμασε αργότερα.',403);
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  const {error}=await db.from('voltes_admin_sessions').insert({token_hash:await digest(token),pin_version:await pinVersion()});if(error)throw error;
  return reply({ok:true,adminToken:token});
 }
 if(action==='state'){
  const [a,b,c,d]=await Promise.all([
   db.from('voltes_rides').select('*').order('date',{ascending:false}),
   admin?db.from('voltes_riders').select('*').order('name'):db.from('voltes_riders').select('name,member,avatar_data_url').eq('member',true).order('name'),
   db.from('voltes_signups').select('ride_id,name,cancel_token_hash'),
   admin?db.from('voltes_ride_admin_notes').select('ride_id,slowdown_notes'):Promise.resolve({data:[],error:null})
  ]);
  if(a.error||b.error||c.error||d.error)throw a.error||b.error||c.error||d.error;
  const ownTokens=new Map<string,string>();
  if(payload.signupTokens&&typeof payload.signupTokens==='object'&&!Array.isArray(payload.signupTokens)){
   const entries=Object.entries(payload.signupTokens).slice(0,500);
   await Promise.all(entries.map(async([id,token])=>{if(tokenValid(token))ownTokens.set(id,await digest(token))}));
  }
  const notes=new Map((d.data||[]).map(n=>[n.ride_id,n.slowdown_notes]));
 const templatesResult=admin?await db.from('voltes_route_templates').select('id,name,points,route_type,estimate').order('name'): {data:[],error:null};
 if(templatesResult.error)throw templatesResult.error;
 
 const rateByType:Record<string,number>={flat:20,mixed:12,mountain:9};
 const calculate=(r:any,guests:string[])=>{
  const distance=Number(r.estimate||0);if(!(distance>0))return null;
  const category=r.route_type||'flat',baseline=rateByType[category]||20;
  const completed=(a.data||[]).filter((x:any)=>x.done&&Number(x.km)>0&&Number(x.moving_minutes)>0&&(x.route_type||'flat')===category&&Math.abs(Number(x.km)*60/Number(x.moving_minutes)-Number(x.speed||0))<4);
  const group=guests.map((n:string)=>n.toLocaleLowerCase('el').trim());
  const candidates=completed.map((x:any)=>{
   const riders=(Array.isArray(x.attendees)?x.attendees:[]).map((n:string)=>String(n).toLocaleLowerCase('el').trim());
   const shared=group.filter((n:string)=>riders.includes(n)).length;
   const union=new Set([...group,...riders]).size;
   const overlap=group.length&&union?shared/union:0;
   const ratio=Number(x.km)/distance;
   const proximity=Math.min(ratio,1/ratio);
   const weight=Math.max(0.01,overlap)*Math.pow(proximity,3);
   return {speed:Number(x.km)*60/Number(x.moving_minutes),weight,overlap};
  }).filter((x:any)=>Number.isFinite(x.speed)&&x.speed>2&&x.speed<70);
  const useful=group.length>0?candidates.filter((x:any)=>x.overlap>0):[];
  const pool=useful.length?useful:[];
  const source=pool.length>=1?'history':'default';
  const speed=source==='history'?pool.reduce((s:number,x:any)=>s+x.speed*x.weight,0)/pool.reduce((s:number,x:any)=>s+x.weight,0):baseline;
  return {minutes:Math.ceil(distance/speed*60)+10,speed:Math.round(speed*10)/10,source,samples:source==='history'?pool.length:0};
 };
 // Freeze only when first requested inside the 15-minute window; never on signup.
 const now=Date.now();
 const known=(a.data||[]).filter((r:any)=>!r.done&&r.public_forecast_minutes==null&&r.estimate&&/^([01]\d|2[0-3]):[0-5]\d$/.test(String(r.time||'')));
 for(const r of known){
  // Europe/Athens offset derives from Intl to account for DST.
  const y=Number(r.date.slice(0,4)),m=Number(r.date.slice(5,7))-1,d=Number(r.date.slice(8,10));
  const clock=new Date(Date.UTC(y,m,d,Number(r.time.slice(0,2)),Number(r.time.slice(3,5))));
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Athens',timeZoneName:'shortOffset'}).formatToParts(clock);
  const offset=parts.find((x:any)=>x.type==='timeZoneName')?.value||'GMT+2';
  const mo=/GMT([+-])([0-9]{1,2})(?::([0-9]{2}))?/.exec(offset);
  const delta=mo?(mo[1]==='+'?1:-1)*(Number(mo[2])*60+Number(mo[3]||0)):120;
  const at=Date.UTC(y,m,d,Number(r.time.slice(0,2)),Number(r.time.slice(3,5)))-delta*60000;
  if(now>=at-15*60000){
   const signupNames=(c.data||[]).filter((s:any)=>s.ride_id===r.id).map((s:any)=>s.name);
   const predicted=calculate(r,signupNames);
   if(predicted){const updated=await db.from('voltes_rides').update({public_forecast_minutes:predicted.minutes}).eq('id',r.id).is('public_forecast_minutes',null).select('public_forecast_minutes').maybeSingle();if(updated.error)throw updated.error;if(updated.data)r.public_forecast_minutes=updated.data.public_forecast_minutes;else {const newer=await db.from('voltes_rides').select('public_forecast_minutes').eq('id',r.id).single();r.public_forecast_minutes=newer.data?.public_forecast_minutes??null;}}
  }
 }
 const rides=(a.data||[]).map(r=>{
   const signups=(c.data||[]).filter(s=>s.ride_id===r.id);
   const base={id:r.id,date:r.date,time:r.time,timePeriod:r.time_period??null,place:r.place,title:r.title,estimate:r.estimate,done:r.done,km:r.km,
    elevationGain:r.elevation_gain_m??null,movingMinutes:r.moving_minutes??null,
    routeType:r.route_type||'flat',routePoints:r.route_points||[],publicForecastMinutes:r.public_forecast_minutes??null,signupCount:signups.length,mySignup:!r.done&&signups.some(s=>!!s.cancel_token_hash&&s.cancel_token_hash===ownTokens.get(r.id)),attendeeCount:Array.isArray(r.attendees)?r.attendees.length:0};
   return admin?{...base,routeTemplateId:r.route_template_id??null,forecast:!r.done?calculate(r,signups.map((s:any)=>s.name)):null,speed:r.speed,strava:r.strava,attendees:r.attendees,slowed:r.slowed,slowdownNotes:notes.get(r.id)||'',signups:signups.map(s=>({name:s.name}))}:base;
  });
  const future=(a.data||[]).filter((r:any)=>!r.done&&/^([01]\d|2[0-3]):[0-5]\d$/.test(String(r.time||''))&&String(r.date)>=new Date(Date.now()-2*86400000).toISOString().slice(0,10)).slice(0,8);
  const weatherPairs=await Promise.all(future.map(async(r:any)=>[r.id,await weatherFor(r)] as const));
  const weather=Object.fromEntries(weatherPairs.filter((x:any)=>x[1]));
  for(const ride of rides){if(weather[ride.id])ride.weather=weather[ride.id]}
  // Expose only aggregate participation, never per-ride member identity to visitors.
  const recentCompleted=(a.data||[]).filter((r:any)=>r.done===true);
  const activityTotal=recentCompleted.length;
  const activityCounts=new Map<string,number>();
  const activityDistances=new Map<string,number>();
  const normalizeRider=(name:unknown)=>String(name??'').trim().toLocaleLowerCase('el-GR');
  for(const ride of recentCompleted){
   const attendees=new Set((Array.isArray(ride.attendees)?ride.attendees:[]).map(normalizeRider).filter(Boolean));
   const km=Number(ride.km);
   for(const name of attendees){
    activityCounts.set(name,(activityCounts.get(name)||0)+1);
    if(Number.isFinite(km)&&km>0)activityDistances.set(name,(activityDistances.get(name)||0)+km);
   }
  }
  const publicMembers=(b.data||[]).filter((x:any)=>x.member).map((x:any)=>({
   name:x.name,member:true,avatar_data_url:x.avatar_data_url,
   activityCount:activityCounts.get(normalizeRider(x.name))||0,activityTotal,
   activityKm:Math.round((activityDistances.get(normalizeRider(x.name))||0)*100)/100
  }));
  const members=publicMembers.length;
  return reply({rides,routeTemplates:admin?(templatesResult.data||[]).map((t:any)=>({...t,usageCount:(a.data||[]).filter((ride:any)=>ride.route_template_id===t.id).length})):[],riders:admin?(b.data||[]):[],publicMembers,members,admin,capabilities:{rideCompletionV2:true,memberExperienceV2:true}});
 }
 if(action==='signup'||action==='cancelSignup'){
  const id=norm(payload.id,40),name=norm(payload.name,70);
  if(!/^[0-9a-f-]{36}$/i.test(id))return bad();
  if(action==='cancelSignup'&&!tokenValid(payload.cancelToken))return bad();
  if(action==='signup'&&(name.length<2||(payload.cancelToken!=null&&!tokenValid(payload.cancelToken))))return bad();
  const hash=tokenValid(payload.cancelToken)?await digest(payload.cancelToken):null;
  const {error}=await db.rpc(action==='signup'?'voltes_signup':'voltes_cancel_signup',action==='signup'?{p_id:id,p_name:name,p_hash:hash}:{p_id:id,p_hash:hash});
  if(error){if(error.code==='23505')return bad('Υπάρχει ήδη δήλωση με αυτό το όνομα.',409);if(error.code==='P0002')return bad('Η βόλτα δεν δέχεται αλλαγές συμμετοχής.',409);throw error}
  return reply({ok:true});
 }
 if(action==='setAvatar'){
  const id=norm(payload.id,40),avatar=payload.avatar;
  if(!/^[0-9a-f-]{36}$/i.test(id))return bad();
  if(avatar!==null){
   if(typeof avatar!=='string'||avatar.length>90000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(avatar))return bad('Μη έγκυρη φωτογραφία.');
   let bytes;try{bytes=atob(avatar.split(',')[1])}catch{return bad('Μη έγκυρη φωτογραφία.')}
   if(bytes.length<4||bytes.charCodeAt(0)!==255||bytes.charCodeAt(1)!==216||bytes.charCodeAt(2)!==255)return bad('Απαιτείται φωτογραφία JPEG.');
  }
  const {data,error}=await db.from('voltes_riders').update({avatar_data_url:avatar}).eq('id',id).select('id').maybeSingle();if(error)throw error;if(!data)return bad('Ο ποδηλάτης δεν βρέθηκε.',404);
  return reply({ok:true});
 }
 if(action==='saveRoute'){
  const name=norm(payload.name,100),type=norm(payload.routeType,15);
  const points=Array.isArray(payload.points)?payload.points.map((x:unknown)=>norm(x,80)).filter(Boolean):[];
  if(name.length<2||!['flat','mixed','mountain'].includes(type)||points.length<2||points.length>6||points.some((x:string)=>x.length<2))return bad('Συμπλήρωσε όνομα και 2–6 σημεία.');
  const estimate=payload.estimate==null||payload.estimate===''?null:Number(payload.estimate);
  if(estimate!==null&&(!Number.isFinite(estimate)||estimate<=0||estimate>1000))return bad();
  const {error}=await db.from('voltes_route_templates').insert({name,points,route_type:type,estimate});
  if(error){if(error.code==='23505')return bad('Υπάρχει ήδη διαδρομή με αυτό το όνομα.',409);throw error}
  return reply({ok:true});
 }
 if(action==='editRoute'){
  if(!admin)return bad('Απαιτείται σύνδεση Admin.',403);
  const id=norm(payload.id,40),name=norm(payload.name,100),type=norm(payload.routeType,15);
  const points=Array.isArray(payload.points)?payload.points.map((x:unknown)=>norm(x,80)).filter(Boolean):[];
  if(!/^[0-9a-f-]{36}$/i.test(id)||name.length<2||!['flat','mixed','mountain'].includes(type)||points.length<2||points.length>6||points.some((x:string)=>x.length<2))return bad('Ελέγξτε τα στοιχεία της διαδρομής.');
  const estimate=payload.estimate==null||payload.estimate===''?null:Number(payload.estimate);
  if(estimate!==null&&(!Number.isFinite(estimate)||estimate<=0||estimate>1000))return bad('Μη έγκυρα χιλιόμετρα.');
  const {data,error}=await db.from('voltes_route_templates').update({name,points,route_type:type,estimate}).eq('id',id).select('id').maybeSingle();
  if(error){if(error.code==='23505')return bad('Υπάρχει ήδη διαδρομή με αυτό το όνομα.',409);throw error}
  if(!data)return bad('Η διαδρομή δεν βρέθηκε.',404);
  return reply({ok:true});
 }
 if(action==='create'){
  const date=norm(payload.date,10),time=norm(payload.time,5),place=norm(payload.place,120),title=norm(payload.title,100)||'Ποδηλατική βόλτα';
  const timePeriod=norm(payload.timePeriod,12);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!place||!(['','morning','noon','afternoon'].includes(timePeriod))|| (time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))||(!time&&!timePeriod))return bad('Συμπλήρωσε έγκυρη ημερομηνία και ώρα ή μέρος της ημέρας.');
  const validDate=new Date(date+'T12:00:00Z');
  if(!Number.isFinite(validDate.getTime())||validDate.toISOString().slice(0,10)!==date)return bad('Μη έγκυρη ημερομηνία.');
  const estimate=payload.estimate?Number(payload.estimate):null;const routeType=norm(payload.routeType,15)||'flat';if(!['flat','mixed','mountain'].includes(routeType))return bad();
  if(estimate!==null&&(!Number.isFinite(estimate)||estimate<=0||estimate>1000))return bad();
  let templateId=null,points:string[]=[];const requestedId=norm(payload.routeTemplateId,40);
  if(requestedId){if(!/^[0-9a-f-]{36}$/i.test(requestedId))return bad();const found=await db.from('voltes_route_templates').select('id,name,points,route_type,estimate').eq('id',requestedId).maybeSingle();if(found.error)throw found.error;if(!found.data)return bad('Η αποθηκευμένη διαδρομή δεν βρέθηκε.',404);templateId=found.data.id;points=found.data.points;}
  const {error}=await db.from('voltes_rides').insert({date,time,time_period:timePeriod||null,place,title,estimate,route_type:routeType,route_template_id:templateId,route_points:points});if(error)throw error;
  return reply({ok:true});
 }
 if(action==='addRider'){
  const name=norm(payload.name,70);if(name.length<2)return bad();
  const {error}=await db.from('voltes_riders').insert({name,member:!!payload.member});
  if(error){if(error.code==='23505')return bad('Το όνομα υπάρχει ήδη',409);throw error}
  return reply({ok:true});
 }
 if(action==='deleteRider'){
  const id=norm(payload.id,40);
  if(!/^[0-9a-f-]{36}$/i.test(id))return bad('Μη έγκυρος ποδηλάτης.');
  const bikes=await db.from('voltes_bikes').select('id').eq('member_id',id).limit(1);
  if(bikes.error)throw bikes.error;
  if(bikes.data?.length)return bad('Το μέλος έχει καταχωρισμένα ποδήλατα. Η διαγραφή εμποδίζεται για να μη χαθούν τα σέρβις.',409);
  const {data,error}=await db.from('voltes_riders').delete().eq('id',id).select('id').maybeSingle();
  if(error){if(error.code==='23503')return bad('Το μέλος έχει συνδεδεμένα δεδομένα και δεν διαγράφεται.',409);throw error}
  if(!data)return bad('Ο ποδηλάτης δεν βρέθηκε.',404);
  return reply({ok:true});
 }
 if(action==='toggleMember'){
  const id=norm(payload.id,40);
  const {data:r,error:e}=await db.from('voltes_riders').select('member').eq('id',id).single();if(e)throw e;
  const {error}=await db.from('voltes_riders').update({member:!r.member}).eq('id',id);if(error)throw error;
  return reply({ok:true});
 }
 if(action==='delete'){
  const {error}=await db.from('voltes_rides').delete().eq('id',norm(payload.id,40));if(error)throw error;
  return reply({ok:true});
 }
 if(action==='editCompletedRide'){
  const id=norm(payload.id,40);
  if(!/^[0-9a-f-]{36}$/i.test(id))return bad('Μη έγκυρη βόλτα.');
  const title=norm(payload.title,100);
  if(title.length<2)return bad('Συμπλήρωσε τίτλο διαδρομής.');
  if(!Array.isArray(payload.attendees)||payload.attendees.length<1||payload.attendees.length>50||
     payload.attendees.some((n:unknown)=>typeof n!=='string'||n.trim().length<2||n.trim().length>70))return bad('Επίλεξε τουλάχιστον έναν έγκυρο συμμετέχοντα.');
  const attendees=[...new Set((payload.attendees as string[]).map(n=>n.trim()))];
  if(attendees.length!==payload.attendees.length)return bad('Υπάρχουν διπλοί συμμετέχοντες.');
  if(!Array.isArray(payload.points)||payload.points.length>6||
     (payload.points.length!==0&&payload.points.length<2)||
     payload.points.some((p:unknown)=>typeof p!=='string'||p.trim().length<2||p.trim().length>80))return bad('Συμπλήρωσε έως 6 βασικά σημεία, τουλάχιστον 2 ή κανένα.');
  const points=(payload.points as string[]).map(p=>p.trim());
  const routeType=norm(payload.routeType,15);
  if(!['flat','mixed','mountain'].includes(routeType))return bad('Μη έγκυρος τύπος διαδρομής.');
  const templateId=norm(payload.routeTemplateId,40);
  if(templateId&&!/^[0-9a-f-]{36}$/i.test(templateId))return bad('Μη έγκυρη αποθηκευμένη διαδρομή.');
  const [ride,riders,template]=await Promise.all([
   db.from('voltes_rides').select('id,done,attendees,slowed').eq('id',id).maybeSingle(),
   db.from('voltes_riders').select('name'),
   templateId?db.from('voltes_route_templates').select('id').eq('id',templateId).maybeSingle():Promise.resolve({data:null,error:null})
  ]);
  if(ride.error||riders.error||template.error)throw ride.error||riders.error||template.error;
  if(!ride.data||ride.data.done!==true)return bad('Δεν βρέθηκε ολοκληρωμένη βόλτα.',404);
  if(templateId&&!template.data)return bad('Η αποθηκευμένη διαδρομή δεν υπάρχει πλέον.',404);
  const validNames=new Set([...(riders.data||[]).map((r:any)=>r.name),...(Array.isArray(ride.data.attendees)?ride.data.attendees:[])]);
  if(attendees.some(n=>!validNames.has(n)))return bad('Κάποιος συμμετέχων δεν βρίσκεται στη λίστα ποδηλατών.',400);
  const slowed=Array.isArray(ride.data.slowed)?ride.data.slowed.filter((n:string)=>attendees.includes(n)):[];
  const {data,error}=await db.from('voltes_rides').update({
   title,attendees,slowed,route_points:points,route_type:routeType,route_template_id:templateId||null
  }).eq('id',id).eq('done',true).select('id').maybeSingle();
  if(error)throw error;
  if(!data)return bad('Η βόλτα δεν βρέθηκε ή δεν είναι ολοκληρωμένη.',409);
  return reply({ok:true});
 }
 if(action==='addHistoricalRide'){
  const date=norm(payload.date,10),time=norm(payload.time,5),title=norm(payload.title,100);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return bad('Μη έγκυρη ημερομηνία ή ώρα.');
  const dateValue=new Date(date+'T12:00:00Z');
  if(!Number.isFinite(dateValue.getTime())||dateValue.toISOString().slice(0,10)!==date||dateValue.getTime()>Date.now()+86400000||date<'2000-01-01')return bad('Η ημερομηνία πρέπει να είναι πραγματική και όχι μελλοντική.');
  let details;
  try{if(typeof payload.movingMinutes!=='number'||!Number.isInteger(payload.movingMinutes)||payload.movingMinutes<1||payload.movingMinutes>59999)throw Error('Μη έγκυρος χρόνος κίνησης.');details=validateCompletion({...payload,movingTime:formatMovingTime(payload.movingMinutes)})}
  catch(e){return bad(e instanceof Error?e.message:undefined)}
  const existing=await db.from('voltes_rides').select('id,km,moving_minutes').eq('date',date).eq('done',true);
  if(existing.error)throw existing.error;
  if((existing.data||[]).some((r:any)=>Math.abs(Number(r.km)-details.km)<0.15&&Math.abs(Number(r.moving_minutes)-details.movingMinutes)<=2))return bad('Πιθανή διπλοεγγραφή: υπάρχει ήδη βόλτα με ίδια ημερομηνία, απόσταση και χρόνο.',409);
  let templateId=null,points:string[]=[],routeType='flat',name=title;
  const requested=norm(payload.routeTemplateId,40);
  if(requested){if(!/^[0-9a-f-]{36}$/i.test(requested))return bad('Μη έγκυρη διαδρομή.');const found=await db.from('voltes_route_templates').select('id,name,points,route_type').eq('id',requested).maybeSingle();if(found.error)throw found.error;if(!found.data)return bad('Δεν βρέθηκε η διαδρομή.',404);templateId=found.data.id;points=found.data.points;routeType=found.data.route_type;name=name||found.data.name}
  const {error}=await db.from('voltes_rides').insert({date,time,place:'Ιστορική βόλτα',title:name||'Παλιά βόλτα',done:true,km:details.km,speed:details.speed,strava:details.strava,attendees:details.attendees,slowed:details.slowed,elevation_gain_m:details.elevationGain,moving_minutes:details.movingMinutes,route_type:routeType,route_template_id:templateId,route_points:points});
  if(error)throw error;
  return reply({ok:true});
 }
 if(action==='finish'){
  const id=norm(payload.id,40);
  if(!/^[0-9a-f-]{36}$/i.test(id))return bad();
  let details;
  try{
   if(typeof payload.movingMinutes!=='number'||!Number.isInteger(payload.movingMinutes)||payload.movingMinutes<1||payload.movingMinutes>59999)throw Error('Μη έγκυρος χρόνος κίνησης.');
   details=validateCompletion({...payload,movingTime:formatMovingTime(payload.movingMinutes)});
  }catch(e){return bad(e instanceof Error?e.message:undefined)}
  const {error}=await db.rpc('voltes_finish_ride',{p_id:id,p_details:{km:details.km,speed:details.speed,attendees:details.attendees,slowed:details.slowed,strava:details.strava,elevation_gain_m:details.elevationGain,moving_minutes:details.movingMinutes,slowdown_notes:details.slowdownNotes}});
  if(error){if(error.code==='P0002')return bad('Η βόλτα έχει ήδη ολοκληρωθεί ή δεν υπάρχει.',409);throw error}
  return reply({ok:true});
 }
 return bad('Άγνωστη ενέργεια',404);
 }catch(error){console.error(error);return bad('Σφάλμα υπηρεσίας. Δοκιμάστε ξανά.',500)}
});
