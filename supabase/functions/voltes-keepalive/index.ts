import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ORIGIN="https://seemsfunny21.github.io";
const PROJECT_URL=Deno.env.get("SUPABASE_URL")||"";
const ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const PIN=Deno.env.get("ADMIN_PIN")||"";
if(!PROJECT_URL||!ROLE_KEY)throw new Error("Missing Supabase credentials");
const db=createClient(PROJECT_URL,ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const headers={
 "Access-Control-Allow-Origin":ORIGIN,
 "Access-Control-Allow-Methods":"POST, OPTIONS",
 "Access-Control-Allow-Headers":"Content-Type",
 "Content-Type":"application/json; charset=utf-8",
 "Cache-Control":"no-store",
 "Vary":"Origin"
};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
const sha256=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,"0")).join("");
async function isAdmin(token:unknown):Promise<boolean>{
 if(typeof token!=="string"||!/^[0-9a-f]{64}$/.test(token)||!PIN)return false;
 const session=await db.from("voltes_admin_sessions").select("pin_version").eq("token_hash",await sha256(token)).maybeSingle();
 if(session.error)throw session.error;
 const version=await sha256(ROLE_KEY+":"+PIN);
 return Boolean(session.data&&session.data.pin_version===version);
}
Deno.serve(async(request:Request)=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
 const origin=request.headers.get("Origin");
 if(origin&&origin!==ORIGIN)return json({ok:false,error:"Origin not allowed"},403);
 if(request.method!=="POST")return json({ok:false,error:"Method not allowed"},405);
 try{
  const raw=await request.text();
  if(raw.length>1500)return json({ok:false,error:"Request too large"},413);
  const payload=JSON.parse(raw);
  if(!payload||typeof payload!=="object"||!await isAdmin(payload.adminToken))
    return json({ok:false,error:"Απαιτείται σύνδεση Admin."},403);
  if(payload.action==="state"){
   const result=await db.from("voltes_keepalive_state").select("last_pressed_at").eq("id",true).single();
   if(result.error)throw result.error;
   return json({ok:true,lastPressedAt:result.data.last_pressed_at,serverNow:new Date().toISOString()});
  }
  if(payload.action==="press"){
   // A real database read is enough: no sample records are ever created or deleted.
   const checked=await db.from("voltes_rides").select("id",{head:true,count:"exact"});
   if(checked.error)throw checked.error;
   const pressedAt=new Date().toISOString();
   const saved=await db.from("voltes_keepalive_state")
      .update({last_pressed_at:pressedAt,last_notified_for:null})
      .eq("id",true).select("last_pressed_at").single();
   if(saved.error)throw saved.error;
   return json({ok:true,lastPressedAt:saved.data.last_pressed_at,serverNow:new Date().toISOString()});
  }
  return json({ok:false,error:"Unknown action"},404);
 }catch(e){
  console.error("Voltes keepalive error",String(e).slice(0,300));
  return json({ok:false,error:"Ο έλεγχος βάσης απέτυχε. Δοκίμασε ξανά."},500);
 }
});
