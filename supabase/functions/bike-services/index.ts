import {createClient} from 'npm:@supabase/supabase-js@2';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const reply=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers});
const bad=(msg:string,status=400)=>reply({error:msg},status);
const uuid=(x:unknown)=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const plain=(x:unknown,max:number)=>typeof x==='string'?x.trim().slice(0,max+1):'';

/* One Strava screenshot supplies a ride distance to every recorded participant,
   regardless of the member who uploaded it. */
const normName=(s:unknown)=>String(s??'').trim().toLocaleLowerCase('el-GR');
async function attendedRides(name:string){
 const found:{date:string,km:number}[]=[];const match=normName(name),batch=500;
 for(let start=0;start<200000;start+=batch){
  const {data,error}=await db.from('voltes_rides').select('date,km,attendees').eq('done',true).not('km','is',null).order('date',{ascending:true}).range(start,start+batch-1);
  if(error)throw error;
  for(const ride of data||[]){
   const km=Number(ride.km);
   if(Number.isFinite(km)&&km>0&&Array.isArray(ride.attendees)&&ride.attendees.some((n:unknown)=>normName(n)===match))found.push({date:ride.date,km});
  }
  if(!data||data.length<batch)break;
 }
 return found;
}
const sumKm=(rides:{date:string,km:number}[])=>Math.round(rides.reduce((sum,r)=>sum+r.km,0)*100)/100;
function odometer(bike:any,rides:{date:string,km:number}[],singleBike:boolean){
 const base=bike.odometer_base_km==null?null:Number(bike.odometer_base_km);
 if(!singleBike)return base;
 if(base===null)return sumKm(rides);
 if(!bike.odometer_base_date)return base;
 return Math.round((base+sumKm(rides.filter(r=>r.date>bike.odometer_base_date)))*100)/100;
}
const genericBikeName='Το ποδήλατό μου';
const defaults=[
 {label:'Λίπανση αλυσίδας',interval_km:200,interval_days:null,notes:'Αρχή μέτρησης: 0 χλμ. της εφαρμογής. Η προηγούμενη λίπανση δεν είναι γνωστή.'},
 {label:'Έλεγχος φθοράς αλυσίδας',interval_km:500,interval_days:null,notes:'Αρχή μέτρησης: 0 χλμ. της εφαρμογής. Έλεγχος φθοράς, όχι αυτόματη αντικατάσταση.'},
 {label:'Έλεγχος φρένων',interval_km:400,interval_days:null,notes:'Αρχή μέτρησης: 0 χλμ. της εφαρμογής. Έλεγχος λειτουργίας και φθοράς.'},
 {label:'Γενικό σέρβις',interval_km:2000,interval_days:365,notes:'Αρχή μέτρησης: 0 χλμ. της εφαρμογής. Ημερομηνία επόμενου ελέγχου αρχίζει μετά την πρώτη πραγματική καταχώριση.'}
];
async function seedMaintenance(bikeId:string){
 const {data:existing,error:ee}=await db.from('voltes_bike_maintenance').select('id').eq('bike_id',bikeId).limit(1);
 if(ee)throw ee;if(existing?.length)return;
 const rows=defaults.map(t=>({...t,bike_id:bikeId,last_km:0,last_date:null}));
 const {error}=await db.from('voltes_bike_maintenance').upsert(rows,{onConflict:'bike_id,label',ignoreDuplicates:true});
 if(error)throw error;
}
async function ensureMemberBike(memberId:string){
 const query=()=>db.from('voltes_bikes').select('id,member_id,name,is_default,odometer_base_km,odometer_base_date').eq('member_id',memberId);
 const {data:existing,error:ee}=await query();
 if(ee)throw ee;let bikes=existing||[];
 if(!bikes.length){
  const {data:created,error}=await db.from('voltes_bikes').insert({member_id:memberId,name:genericBikeName,is_default:true})
    .select('id,member_id,name,is_default,odometer_base_km,odometer_base_date').single();
  if(error&&error.code!=='23505')throw error;
  if(created)bikes=[created];
  else{const retry=await query();if(retry.error)throw retry.error;bikes=retry.data||[];}
 }
 for(const bike of bikes)await seedMaintenance(bike.id);
 return bikes;
}
const athensDay=()=>{
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Athens',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
};
const validDate=(s:unknown)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return bad('Method not allowed',405);
 let p:any;try{p=await req.json()}catch{return bad('Μη έγκυρα δεδομένα')}
 if(!p||typeof p!=='object'||Array.isArray(p))return bad('Μη έγκυρα δεδομένα');
 try{
  const action=p.action;
  if(action==='state'){
   // Only return the chosen member's records, minimizing transfer on free-tier hosting.
   const name=plain(p.memberName,70);
   if(!name)return reply({bikes:[],services:[]});
   const {data:member,error:me}=await db.from('voltes_riders').select('id').eq('name',name).eq('member',true).maybeSingle();
   if(me)throw me;if(!member)return reply({bikes:[],services:[]});
   const bikes=await ensureMemberBike(member.id);
   if(!bikes.length)return reply({bikes:[],services:[],maintenance:[],memberKm:0});
   const {data:services,error:se}=await db.from('voltes_bike_services').select('id,bike_id,service_date,work,km,notes').in('bike_id',bikes.map((b:any)=>b.id)).is('deleted_at',null).order('service_date',{ascending:false});
   if(se)throw se;
   const {data:maintenance,error:te}=await db.from('voltes_bike_maintenance').select('id,bike_id,label,interval_km,interval_days,last_km,last_date,notes').in('bike_id',bikes.map((b:any)=>b.id)).order('created_at');
   if(te)throw te;
   const rides=await attendedRides(name),memberKm=sumKm(rides);
   const decorated=bikes.map((bike:any)=>({...bike,member_name:name,odometer_km:odometer(bike,rides,bikes.length===1),auto_tracking:bikes.length===1,member_km:memberKm}));
   return reply({bikes:decorated,services:services||[],maintenance:maintenance||[],memberKm});
  }
  if(!['createBike','setDefault','addService','updateService','deleteService','importService','completeMaintenance','saveMaintenance','deleteMaintenance','setOdometer'].includes(action))return bad('Άγνωστη ενέργεια',404);
  const memberName=plain(p.memberName,70);if(memberName.length<2)return bad('Επίλεξε μέλος από τις Ρυθμίσεις.');
  const {data:member,error:me}=await db.from('voltes_riders').select('id').eq('name',memberName).eq('member',true).maybeSingle();
  if(me)throw me;if(!member)return bad('Το μέλος δεν βρέθηκε.',404);
  if(action==='createBike'){
   const name=plain(p.name,90);if(name.length<2||name.length>90)return bad('Γράψε όνομα ποδηλάτου (2–90 χαρακτήρες).');
   const {data:existing,error:ee}=await db.from('voltes_bikes').select('id,name').eq('member_id',member.id);
   if(ee)throw ee;
   const found=existing?.find(b=>b.name.toLocaleLowerCase('el-GR')===name.toLocaleLowerCase('el-GR'));
   if(found)return reply({ok:true,bike:found});
   if(existing?.length===1&&existing[0].name===genericBikeName){
    const {data,error}=await db.from('voltes_bikes').update({name}).eq('id',existing[0].id).select('id,name').single();
    if(error)throw error;return reply({ok:true,bike:data});
   }
   const {data,error}=await db.from('voltes_bikes').insert({member_id:member.id,name,is_default:!existing?.length}).select('id,name').single();
   if(error)throw error;await seedMaintenance(data.id);return reply({ok:true,bike:data});
  }
  if(!uuid(p.bikeId))return bad('Μη έγκυρο ποδήλατο.');
  const {data:bike,error:be}=await db.from('voltes_bikes').select('id,member_id,odometer_base_km,odometer_base_date').eq('id',p.bikeId).eq('member_id',member.id).maybeSingle();
  if(be)throw be;if(!bike)return bad('Το ποδήλατο δεν ανήκει στο επιλεγμένο μέλος.',404);

  if(action==='setOdometer'){
   const value=Number(p.km);
   if(!Number.isFinite(value)||value<0||value>1000000)return bad('Μη έγκυρη ένδειξη χιλιομέτρων.');
   const {error}=await db.from('voltes_bikes').update({odometer_base_km:Math.round(value*100)/100,odometer_base_date:athensDay()}).eq('id',p.bikeId);
   if(error)throw error;
   return reply({ok:true});
  }
  if(action==='saveMaintenance'){
   const label=plain(p.label,100),km=p.intervalKm===''||p.intervalKm==null?null:Number(p.intervalKm),days=p.intervalDays===''||p.intervalDays==null?null:Number(p.intervalDays);
   const anchorKm=p.lastKm===''||p.lastKm==null?null:Number(p.lastKm),anchorDate=p.lastDate===''||p.lastDate==null?null:p.lastDate,notes=plain(p.notes??'',400);
   if(label.length<2||label.length>100||notes.length>400||(km===null&&days===null)||
      km!==null&&(!Number.isInteger(km)||km<1||km>100000)||
      days!==null&&(!Number.isInteger(days)||days<1||days>3650)||
      anchorKm!==null&&(!Number.isFinite(anchorKm)||anchorKm<0||anchorKm>1000000)||
      anchorDate!==null&&(!validDate(anchorDate)||anchorDate>athensDay()))return bad('Έλεγξε τα στοιχεία του προγραμματισμένου ελέγχου.');
   const values={bike_id:p.bikeId,label,interval_km:km,interval_days:days,last_km:anchorKm,last_date:anchorDate,notes};
   if(p.id){
    if(!uuid(p.id))return bad('Μη έγκυρη εργασία.');
    const {data,error}=await db.from('voltes_bike_maintenance').update(values).eq('id',p.id).eq('bike_id',p.bikeId).select('id').maybeSingle();
    if(error)throw error;if(!data)return bad('Η εργασία δεν βρέθηκε.',404);
   }else{
    const {error}=await db.from('voltes_bike_maintenance').insert(values);
    if(error){if(error.code==='23505')return bad('Η εργασία υπάρχει ήδη.');throw error}
   }
   return reply({ok:true});
  }
  if(action==='deleteMaintenance'){
   if(!uuid(p.id))return bad('Μη έγκυρη εργασία.');
   const {data,error}=await db.from('voltes_bike_maintenance').delete().eq('id',p.id).eq('bike_id',p.bikeId).select('id').maybeSingle();
   if(error)throw error;if(!data)return bad('Η εργασία δεν βρέθηκε.',404);
   return reply({ok:true});
  }
  if(action==='completeMaintenance'){
   if(!uuid(p.id))return bad('Μη έγκυρη εργασία.');
   const {data:task,error:te}=await db.from('voltes_bike_maintenance').select('id,label,interval_km,interval_days,last_km,last_date').eq('id',p.id).eq('bike_id',p.bikeId).maybeSingle();
   if(te)throw te;if(!task)return bad('Η εργασία δεν βρέθηκε.',404);
   const {data:allBikes,error:be}=await db.from('voltes_bikes').select('id').eq('member_id',member.id);if(be)throw be;
   const rides=await attendedRides(memberName);
   const km=odometer(bike,rides,(allBikes||[]).length===1);
   if(task.interval_km&&km===null)return bad('Πρώτα συμπλήρωσε τα συνολικά χιλιόμετρα του ποδηλάτου.');
   const today=athensDay();
   if(task.last_date===today&&(!task.interval_km||Number(task.last_km)===km))return reply({ok:true,unchanged:true});
   const {error}=await db.from('voltes_bike_maintenance').update({last_km:task.interval_km?km:task.last_km,last_date:today}).eq('id',p.id).eq('bike_id',p.bikeId);
   if(error)throw error;
   const {error:historyError}=await db.from('voltes_bike_services').insert({bike_id:p.bikeId,service_date:today,work:task.label,km:km===null?null:Math.floor(km),notes:'Ολοκλήρωση από το πρόγραμμα συντήρησης'});
   if(historyError)throw historyError;
   return reply({ok:true});
  }
  if(action==='setDefault'){
   // Clear old default first; each operation is idempotent when retried.
   const {error:e1}=await db.from('voltes_bikes').update({is_default:false}).eq('member_id',member.id).eq('is_default',true);if(e1)throw e1;
   const {error:e2}=await db.from('voltes_bikes').update({is_default:true}).eq('id',p.bikeId);if(e2)throw e2;
   return reply({ok:true});
  }
  if(action==='importService'){
   // Import old, device-local records once, without replacing an existing shared record.
   const date=plain(p.date,10),work=plain(p.work,100),notes=plain(p.notes??'',600);
   const d=new Date(date+'T12:00:00Z'),now=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Athens'});
   const km=p.km===''||p.km==null?null:Number(p.km);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date||date>now||work.length<2||work.length>100||notes.length>600||km!==null&&(!Number.isInteger(km)||km<0||km>1000000))return bad('Μη έγκυρο παλιό σέρβις.');
   const original=JSON.stringify([date,work,km,notes]);
   const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(original))),v=>v.toString(16).padStart(2,'0')).join('');
   const {data:existing,error:se}=await db.from('voltes_bike_services').select('id,service_date,work,km,notes,deleted_at').eq('bike_id',p.bikeId);
   if(se)throw se;
   if((existing||[]).some((x:any)=>x.service_date===date&&x.work===work&&x.km===km&&x.notes===notes))return reply({ok:true,imported:false});
   const {error}=await db.from('voltes_bike_services').insert({bike_id:p.bikeId,service_date:date,work,km,notes,import_fingerprint:fingerprint});
   // Concurrent imports are deduplicated by the database unique index.
   if(error){if(error.code==='23505')return reply({ok:true,imported:false});throw error}
   return reply({ok:true,imported:true});
  }
  if(action==='addService'||action==='updateService'){
   const date=plain(p.date,10),work=plain(p.work,100),notes=plain(p.notes??'',600);
   const d=new Date(date+'T12:00:00Z');
   const now=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Athens'});
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date||date>now||work.length<2||work.length>100||notes.length>600)return bad('Έλεγξε τα στοιχεία του σέρβις.');
   const km=p.km===''||p.km==null?null:Number(p.km);
   if(km!==null&&(!Number.isInteger(km)||km<0||km>1000000))return bad('Μη έγκυρα χιλιόμετρα.');
   const values={bike_id:p.bikeId,service_date:date,work,notes,km};
   if(action==='addService'){const {error}=await db.from('voltes_bike_services').insert(values);if(error)throw error}
   else{
    if(!uuid(p.id))return bad('Μη έγκυρη καταχώριση.');
    const {data,error}=await db.from('voltes_bike_services').update(values).eq('id',p.id).eq('bike_id',p.bikeId).is('deleted_at',null).select('id').maybeSingle();
    if(error)throw error;if(!data)return bad('Η καταχώριση δεν βρέθηκε.',404);
   }
   return reply({ok:true});
  }
  if(action==='deleteService'){
   if(!uuid(p.id))return bad('Μη έγκυρη καταχώριση.');
   const {data,error}=await db.from('voltes_bike_services').update({deleted_at:new Date().toISOString()}).eq('id',p.id).eq('bike_id',p.bikeId).is('deleted_at',null).select('id').maybeSingle();
   if(error)throw error;if(!data)return bad('Η καταχώριση δεν βρέθηκε.',404);
   return reply({ok:true});
  }
  return bad('Άγνωστη ενέργεια',404);
 }catch(e){console.error(e);return bad('Σφάλμα υπηρεσίας. Δοκιμάστε ξανά.',500)}
});