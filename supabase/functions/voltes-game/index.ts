import {createClient} from 'npm:@supabase/supabase-js@2';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const valid=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 try{
 const raw=await req.text();if(raw.length>16000)return reply({error:'Μη έγκυρο αίτημα'},400);
 const p=JSON.parse(raw);if(!p||typeof p!=='object'||Array.isArray(p))return reply({error:'Μη έγκυρο αίτημα'},400);
 const action=String(p.action||'');let member=null,admin=false;
 if(valid(p.memberToken)){const x=await db.from('voltes_member_sessions').select('member_id').eq('token_hash',await hash(p.memberToken)).gt('expires_at',new Date().toISOString()).maybeSingle();if(x.error)throw x.error;member=x.data?.member_id||null}
 if(['admin_state','approve_member','approve_activity','reject_activity','set_rate'].includes(action)){
 if(valid(p.adminToken)){const x=await db.from('voltes_admin_sessions').select('pin_version').eq('token_hash',await hash(p.adminToken)).maybeSingle();if(x.error)throw x.error;const pin=Deno.env.get('ADMIN_PIN')||'';admin=!!pin&&x.data?.pin_version===await hash((Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'')+':'+pin)}
 if(!admin)return reply({error:'Απαιτείται Admin'},403);
 }else if(!member)return reply({error:'Συνδέσου στο προφίλ σου'},401);
 const {data,error}=await db.rpc('voltes_game_action',{p_member:member,p_admin:admin,p_action:action,p:{...p,memberToken:undefined,adminToken:undefined}});
 if(error){console.error('voltes-game',error.code);return reply({error:error.code==='23505'?'Η καταχώριση υπάρχει ήδη ή το αντικείμενο έχει αποκτηθεί.':error.code==='P0001'?error.message:'Η ενέργεια δεν ολοκληρώθηκε.'},400)}
 return reply(data);
 }catch(e){console.error('voltes-game',e instanceof Error?e.message:'unknown');return reply({error:'Η υπηρεσία δεν είναι διαθέσιμη.'},500)}
});