import { createClient } from 'npm:@supabase/supabase-js@2';
import '../_shared/completion.js';
const {validateCompletion,formatMovingTime}=(globalThis as unknown as {VoltesCompletion:{validateCompletion:(input:any)=>any;formatMovingTime:(minutes:number)=>string}}).VoltesCompletion;
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const secret=Deno.env.get('ADMIN_PIN');
const norm=(s:unknown,max=100)=>String(s??'').trim().slice(0,max);
const validPin=(p:unknown)=>Boolean(secret)&&typeof p==='string'&&/^\d{4}$/.test(p)&&p===secret;
const bad=(msg='Μη έγκυρα δεδομένα',status=400)=>reply({error:msg},status);
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return bad('Method not allowed',405);
 let payload;
 try{payload=await req.json()}catch{return bad()}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return bad();
 try{
 const action=norm(payload.action,40),admin=validPin(payload.pin);
 if(!['state','signup','login'].includes(action)&&!admin)return bad('Απαιτείται PIN διαχειριστή',403);
 if(action==='login')return admin?reply({ok:true}):bad('Λάθος PIN',403);
 if(action==='state'){
  const [a,b,c,d]=await Promise.all([
   db.from('voltes_rides').select('*').order('date',{ascending:false}),
   admin?db.from('voltes_riders').select('*').order('name'):Promise.resolve({data:[],error:null}),
   db.from('voltes_signups').select('ride_id,name'),
   admin?db.from('voltes_ride_admin_notes').select('ride_id,slowdown_notes'):Promise.resolve({data:[],error:null})
  ]);
  if(a.error||b.error||c.error||d.error)throw a.error||b.error||c.error||d.error;
  const notes=new Map((d.data||[]).map(n=>[n.ride_id,n.slowdown_notes]));
  const rides=(a.data||[]).map(r=>{
   const signups=(c.data||[]).filter(s=>s.ride_id===r.id);
   const base={id:r.id,date:r.date,time:r.time,place:r.place,title:r.title,estimate:r.estimate,done:r.done,km:r.km,
    elevationGain:r.elevation_gain_m??null,movingMinutes:r.moving_minutes??null,
    signupCount:signups.length,attendeeCount:Array.isArray(r.attendees)?r.attendees.length:0};
   return admin?{...base,speed:r.speed,strava:r.strava,attendees:r.attendees,slowed:r.slowed,slowdownNotes:notes.get(r.id)||'',signups:signups.map(s=>({name:s.name}))}:base;
  });
  const members=admin?(b.data||[]).filter(r=>r.member).length:0;
  return reply({rides,riders:admin?(b.data||[]):[],members,admin,capabilities:{rideCompletionV2:true}});
 }
 if(action==='signup'){
  const id=norm(payload.id,40),name=norm(payload.name,70);
  if(!/^[0-9a-f-]{36}$/i.test(id)||name.length<2)return bad();
  const {data:ride,error:er}=await db.from('voltes_rides').select('done').eq('id',id).single();
  if(er||!ride||ride.done)return bad('Η βόλτα δεν δέχεται συμμετοχές',409);
  const {error}=await db.from('voltes_signups').insert({ride_id:id,name});
  if(error){if(error.code==='23505')return bad('Υπάρχει ήδη δήλωση με αυτό το όνομα',409);throw error}
  return reply({ok:true});
 }
 if(action==='create'){
  const date=norm(payload.date,10),time=norm(payload.time,5),place=norm(payload.place,120),title=norm(payload.title,100)||'Ποδηλατική βόλτα';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time)||!place)return bad();
  const estimate=payload.estimate?Number(payload.estimate):null;
  if(estimate!==null&&(!Number.isFinite(estimate)||estimate<=0||estimate>1000))return bad();
  const {error}=await db.from('voltes_rides').insert({date,time,place,title,estimate});if(error)throw error;
  return reply({ok:true});
 }
 if(action==='addRider'){
  const name=norm(payload.name,70);if(name.length<2)return bad();
  const {error}=await db.from('voltes_riders').insert({name,member:!!payload.member});
  if(error){if(error.code==='23505')return bad('Το όνομα υπάρχει ήδη',409);throw error}
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
