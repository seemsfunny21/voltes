import {createClient} from 'npm:@supabase/supabase-js@2';

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{
  auth:{persistSession:false}
});
const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Access-Control-Allow-Headers':'content-type',
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store'
};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const bad=(message='Μη έγκυρα στοιχεία.',status=400)=>reply({error:message},status);
const encoder=new TextEncoder();
const toHex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const digest=async(text:string)=>toHex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text))));
const isToken=(x:unknown):x is string=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const isUuid=(x:unknown)=>typeof x==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const cleanName=(x:unknown)=>typeof x==='string'?x.normalize('NFC').trim():'';
const validPassword=(x:unknown):x is string=>typeof x==='string'&&x.length>=6&&x.length<=64&&x.trim()===x;
const iterations=210000;
const recoveryAlphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normalizeRecovery=(v:unknown)=>typeof v==='string'?v.trim().toUpperCase().replace(/[\\s-]/g,''):'';
const validRecovery=(v:string)=>v.length===20&&[...v].every(c=>recoveryAlphabet.includes(c));
function freshRecoveryCode(){
 const bytes=crypto.getRandomValues(new Uint8Array(20));
 const code=Array.from(bytes,b=>recoveryAlphabet[b&31]).join('');
 return code.match(/.{5}/g)!.join('-');
}
const fromHex=(str:string)=>new Uint8Array((str.match(/../g)||[]).map(x=>parseInt(x,16)));
async function passwordHash(password:string,salt:string,rounds=iterations){
 const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:fromHex(salt),iterations:rounds},key,256);
 return toHex(new Uint8Array(bits));
}
function constantEqual(a:string,b:string){
 if(a.length!==b.length)return false;
 let diff=0;
 for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
async function validMember(token:unknown){
 if(!isToken(token))return null;
 const tokenHash=await digest(token);
 const {data,error}=await db.from('voltes_member_sessions')
  .select('member_id,expires_at').eq('token_hash',tokenHash)
  .gt('expires_at',new Date().toISOString()).maybeSingle();
 if(error)throw error;
 if(!data)return null;
 const member=await db.from('voltes_riders')
  .select('id,name,member,avatar_data_url').eq('id',data.member_id).eq('member',true).maybeSingle();
 if(member.error)throw member.error;
 return member.data||null;
}
async function adminAuthorized(token:unknown){
 if(!isToken(token))return false;
 const {data,error}=await db.from('voltes_admin_sessions').select('pin_version')
  .eq('token_hash',await digest(token)).maybeSingle();
 if(error)throw error;
 const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 const pin=Deno.env.get('ADMIN_PIN')||'';
 return !!data&&!!pin&&data.pin_version===await digest(secret+':'+pin);
}
async function createSession(memberId:string){
 const raw=toHex(crypto.getRandomValues(new Uint8Array(32)));
 const {error}=await db.from('voltes_member_sessions').insert({
  member_id:memberId,token_hash:await digest(raw),
  expires_at:new Date(Date.now()+60*86400000).toISOString()
 });
 if(error)throw error;
 return raw;
}
function validAvatar(value:unknown){
 if(value===null)return true;
 if(typeof value!=='string'||value.length>90000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value))return false;
 try{
  const binary=atob(value.slice('data:image/jpeg;base64,'.length));
  return binary.length>4&&binary.charCodeAt(0)===255&&binary.charCodeAt(1)===216&&binary.charCodeAt(2)===255;
 }catch{return false}
}

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return bad('Method not allowed',405);
 let p:any;try{p=await req.json()}catch{return bad()}
 if(!p||typeof p!=='object'||Array.isArray(p))return bad();
 const action=String(p.action||'').slice(0,40);
 try{
  if(action==='register'){
   const name=cleanName(p.name),password=p.password;
   if(name.length<2||name.length>70||!validPassword(password))
    return bad('Γράψε όνομα ή ψευδώνυμο 2–70 χαρακτήρων και κωδικό 6–64 χαρακτήρων.');
   const salt=toHex(crypto.getRandomValues(new Uint8Array(16)));
   const hash=await passwordHash(password,salt);
   const {data,error}=await db.rpc('voltes_member_register',{
    p_name:name,p_hash:hash,p_salt:salt,p_iterations:iterations
   });
   if(error){
    if(error.code==='23505')return bad('Αυτό το όνομα χρησιμοποιείται ήδη. Διάλεξε άλλο ή ζήτησε ενεργοποίηση από τον Admin.',409);
    if(error.code==='22023')return bad();
    throw error;
   }
   const token=await createSession(data);
   return reply({ok:true,member:{id:data,name},memberToken:token});
  }
  if(action==='login'){
   const name=cleanName(p.name),password=p.password;
   if(name.length<2||name.length>70||(!validPassword(password)&&password!=='1234'))return bad('Λάθος όνομα ή κωδικός.',403);
   const {data:riders,error}=await db.from('voltes_riders').select('id,name,member').eq('member',true);
   if(error)throw error;
   const member=(riders||[]).find((r:any)=>cleanName(r.name).toLocaleLowerCase('el-GR')===name.toLocaleLowerCase('el-GR'));
   const credentials=member?await db.from('voltes_member_credentials').select('password_hash,salt,iterations').eq('member_id',member.id).maybeSingle():{data:null,error:null};
   if(credentials.error)throw credentials.error;
   const stored=credentials.data;
   // Also hash on missing users to avoid leaking registered names via response timing.
   const candidate=await passwordHash(password,stored?.salt||'00000000000000000000000000000000',stored?.iterations||iterations);
   const correct=!!member&&!!stored&&constantEqual(candidate,stored.password_hash);
   const gateKey=await digest('cycling-member-login:'+name.toLocaleLowerCase('el-GR'));
   const result=await db.rpc('voltes_member_login_gate',{p_key:gateKey,p_correct:correct});
   if(result.error)throw result.error;
   if(result.data!==true)return bad('Λάθος όνομα ή κωδικός, ή πολλές αποτυχημένες προσπάθειες. Δοκίμασε αργότερα.',403);
   // A four-character bootstrap code is never allowed to create a normal session.
   if(password==='1234'){
    if(p.newPassword===undefined)return reply({ok:true,mustChangePassword:true});
    if(!validPassword(p.newPassword))return bad('Ο νέος κωδικός πρέπει να έχει 6–64 χαρακτήρες.');
    const salt=toHex(crypto.getRandomValues(new Uint8Array(16))),hash=await passwordHash(p.newPassword,salt);
    const changed=await db.from('voltes_member_credentials').update({password_hash:hash,salt,iterations,updated_at:new Date().toISOString()}).eq('member_id',member.id).eq('password_hash',stored.password_hash).select('member_id').maybeSingle();
    if(changed.error)throw changed.error;
    if(!changed.data)return bad('Ο αρχικός κωδικός δεν ισχύει πλέον.',403);
   }
   const token=await createSession(member.id);
   return reply({ok:true,member:{id:member.id,name:member.name},memberToken:token});
  }
  if(action==='adminAccountStates'){
   if(!await adminAuthorized(p.adminToken))return bad('Απαιτείται Admin.',403);
   const {data,error}=await db.from('voltes_member_credentials').select('member_id');
   if(error)throw error;
   return reply({ok:true,activeMemberIds:(data||[]).map((row:any)=>row.member_id)});
  }
  if(action==='adminIssueReset'){
   if(!await adminAuthorized(p.adminToken))return bad('Απαιτείται Admin.',403);
   if(!isUuid(p.memberId))return bad('Μη έγκυρο μέλος.');
   const {data:member,error:memberError}=await db.from('voltes_riders')
    .select('id,name').eq('id',p.memberId).eq('member',true).maybeSingle();
   if(memberError)throw memberError;
   if(!member)return bad('Το μέλος δεν βρέθηκε.',404);
   const {data:credentials,error:credError}=await db.from('voltes_member_credentials')
    .select('member_id').eq('member_id',member.id).maybeSingle();
   if(credError)throw credError;
   if(!credentials)return bad('Το μέλος δεν έχει ενεργοποιηθεί. Όρισε πρώτα τον αρχικό κωδικό.',409);
   const code=freshRecoveryCode();
   const expiresAt=new Date(Date.now()+60*60*1000).toISOString();
   const {error}=await db.from('voltes_member_password_resets').upsert({
    member_id:member.id,reset_token_hash:await digest(normalizeRecovery(code)),
    created_at:new Date().toISOString(),expires_at:expiresAt
   },{onConflict:'member_id'});
   if(error)throw error;
   // This plaintext code is returned ONCE to the authenticated Admin only.
   return reply({ok:true,memberName:member.name,resetCode:code,expiresAt});
  }
  if(action==='resetPassword'){
   const name=cleanName(p.name);
   const reset=normalizeRecovery(p.resetCode);
   const password=p.newPassword;
   if(name.length<2||name.length>70||!validRecovery(reset)||!validPassword(password))
    return bad('Συμπλήρωσε έγκυρο όνομα, προσωρινό κωδικό και νέο κωδικό 6–64 χαρακτήρων.');
   const {data:members,error:membersError}=await db.from('voltes_riders')
     .select('id,name').eq('member',true);
   if(membersError)throw membersError;
   const member=(members||[]).find((r:any)=>
     cleanName(r.name).toLocaleLowerCase('el-GR')===name.toLocaleLowerCase('el-GR'));
   if(!member)return bad('Ο προσωρινός κωδικός είναι λανθασμένος, έχει χρησιμοποιηθεί ή έληξε.',403);
   const tokenHash=await digest(reset);
   // Reject bogus requests before doing costly password hashing. Final check is atomic in SQL.
   const {data:approval,error:approvalError}=await db.from('voltes_member_password_resets')
     .select('member_id').eq('member_id',member.id).eq('reset_token_hash',tokenHash)
     .gt('expires_at',new Date().toISOString()).maybeSingle();
   if(approvalError)throw approvalError;
   if(!approval)return bad('Ο προσωρινός κωδικός είναι λανθασμένος, έχει χρησιμοποιηθεί ή έληξε.',403);
   const salt=toHex(crypto.getRandomValues(new Uint8Array(16)));
   const hash=await passwordHash(password,salt);
   const consumed=await db.rpc('voltes_member_consume_password_reset',{
     p_member_id:member.id,p_token_hash:tokenHash,p_password_hash:hash,
     p_salt:salt,p_iterations:iterations
   });
   if(consumed.error)throw consumed.error;
   if(consumed.data!==true)
     return bad('Ο προσωρινός κωδικός είναι λανθασμένος, έχει χρησιμοποιηθεί ή έληξε.',403);
   const token=await createSession(member.id);
   return reply({ok:true,member:{id:member.id,name:member.name},memberToken:token});
  }
  if(action==='adminSetPassword'){
   if(!await adminAuthorized(p.adminToken))return bad('Απαιτείται Admin.',403);
   if(!isUuid(p.memberId)||!validPassword(p.password))return bad('Απαιτείται κωδικός 6–64 χαρακτήρων.');
   const found=await db.from('voltes_riders').select('id,name,member').eq('id',p.memberId).eq('member',true).maybeSingle();
   if(found.error)throw found.error;
   if(!found.data)return bad('Το μέλος δεν βρέθηκε.',404);
   // Initial activation ONLY. Existing member passwords may be recovered with a one-hour code.
   const {data:already,error:checkError}=await db.from('voltes_member_credentials')
     .select('member_id').eq('member_id',found.data.id).maybeSingle();
   if(checkError)throw checkError;
   if(already)return bad('Το μέλος έχει ήδη προσωπικό κωδικό. Δώσε έγκριση επαναφοράς μίας ώρας.',409);
   const salt=toHex(crypto.getRandomValues(new Uint8Array(16)));
   const hash=await passwordHash(p.password,salt);
   const saved=await db.from('voltes_member_credentials').insert({
    member_id:found.data.id,password_hash:hash,salt,iterations
   });
   if(saved.error){
     if(saved.error.code==='23505')return bad('Ο κωδικός μέλους έχει ήδη ενεργοποιηθεί.',409);
     throw saved.error;
   }
   return reply({ok:true});
  }
  if(action==='session'){
   const member=await validMember(p.memberToken);
   if(!member)return bad('Η σύνδεση έληξε. Συνδέσου ξανά.',401);
   return reply({ok:true,member:{id:member.id,name:member.name,avatar_data_url:member.avatar_data_url}});
  }
  if(action==='logout'){
   if(isToken(p.memberToken)){
    const result=await db.from('voltes_member_sessions').delete().eq('token_hash',await digest(p.memberToken));
    if(result.error)throw result.error;
   }
   return reply({ok:true});
  }
  if(action==='setAvatar'){
   const member=await validMember(p.memberToken);
   if(!member)return bad('Συνδέσου στο προσωπικό σου προφίλ.',403);
   if(!validAvatar(p.avatar))return bad('Απαιτείται έγκυρη φωτογραφία JPEG.',400);
   const result=await db.from('voltes_riders').update({avatar_data_url:p.avatar}).eq('id',member.id);
   if(result.error)throw result.error;
   return reply({ok:true});
  }
  if(action==='changePassword'){
   const member=await validMember(p.memberToken);
   if(!member)return bad('Συνδέσου στο προσωπικό σου προφίλ.',403);
   if(!validPassword(p.currentPassword)||!validPassword(p.newPassword))
    return bad('Ο νέος κωδικός πρέπει να έχει 6–64 χαρακτήρες.');
   const stored=await db.from('voltes_member_credentials').select('password_hash,salt,iterations').eq('member_id',member.id).maybeSingle();
   if(stored.error)throw stored.error;
   if(!stored.data)return bad('Ζήτησε ενεργοποίηση από τον Admin.',403);
   const current=await passwordHash(p.currentPassword,stored.data.salt,stored.data.iterations);
   if(!constantEqual(current,stored.data.password_hash))return bad('Λάθος τρέχων κωδικός.',403);
   const salt=toHex(crypto.getRandomValues(new Uint8Array(16))),hash=await passwordHash(p.newPassword,salt);
   const result=await db.from('voltes_member_credentials').update({password_hash:hash,salt,iterations,updated_at:new Date().toISOString()})
    .eq('member_id',member.id);
   if(result.error)throw result.error;
   const revoked=await db.from('voltes_member_sessions').delete().eq('member_id',member.id);
   if(revoked.error)throw revoked.error;
   const cleared=await db.from('voltes_member_password_resets').delete().eq('member_id',member.id);
   if(cleared.error)throw cleared.error;
   const token=await createSession(member.id);
   return reply({ok:true,member:{id:member.id,name:member.name},memberToken:token});
  }
  return bad('Άγνωστη ενέργεια.',404);
 }catch(e){console.error('member-accounts:',e instanceof Error?e.message:'unknown');return bad('Η υπηρεσία μελών δεν είναι προσωρινά διαθέσιμη.',500)}
});
