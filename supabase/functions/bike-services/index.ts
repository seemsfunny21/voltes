import {createClient} from 'npm:@supabase/supabase-js@2';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const reply=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers});
const bad=(msg:string,status=400)=>reply({error:msg},status);
const uuid=(x:unknown)=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const plain=(x:unknown,max:number)=>typeof x==='string'?x.trim().slice(0,max+1):'';
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
   const {data:bikes,error:be}=await db.from('voltes_bikes').select('id,member_id,name,is_default').eq('member_id',member.id);
   if(be)throw be;
   if(!bikes?.length)return reply({bikes:[],services:[]});
   const {data:services,error:se}=await db.from('voltes_bike_services').select('id,bike_id,service_date,work,km,notes') .in('bike_id',bikes.map((b:any)=>b.id)).is('deleted_at',null).order('service_date',{ascending:false});
   if(se)throw se;
   return reply({bikes:bikes.map((bike:any)=>({...bike,member_name:name})),services:services||[]});
  }
  if(!['createBike','setDefault','addService','updateService','deleteService','importService'].includes(action))return bad('Άγνωστη ενέργεια',404);
  const memberName=plain(p.memberName,70);if(memberName.length<2)return bad('Επίλεξε μέλος από τις Ρυθμίσεις.');
  const {data:member,error:me}=await db.from('voltes_riders').select('id').eq('name',memberName).eq('member',true).maybeSingle();
  if(me)throw me;if(!member)return bad('Το μέλος δεν βρέθηκε.',404);
  if(action==='createBike'){
   const name=plain(p.name,90);if(name.length<2||name.length>90)return bad('Γράψε όνομα ποδηλάτου (2–90 χαρακτήρες).');
   const {data:existing,error:ee}=await db.from('voltes_bikes').select('id,name').eq('member_id',member.id);
   if(ee)throw ee;
   const found=existing?.find(b=>b.name.toLocaleLowerCase('el-GR')===name.toLocaleLowerCase('el-GR'));
   if(found)return reply({ok:true,bike:found});
   const {data,error}=await db.from('voltes_bikes').insert({member_id:member.id,name,is_default:!existing?.length}).select('id,name').single();
   if(error)throw error;return reply({ok:true,bike:data});
  }
  if(!uuid(p.bikeId))return bad('Μη έγκυρο ποδήλατο.');
  const {data:bike,error:be}=await db.from('voltes_bikes').select('id,member_id').eq('id',p.bikeId).eq('member_id',member.id).maybeSingle();
  if(be)throw be;if(!bike)return bad('Το ποδήλατο δεν ανήκει στο επιλεγμένο μέλος.',404);
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