'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {pathToFileURL}=require('node:url');
async function main(){
 const root=path.resolve(__dirname,'..'),dist=path.join(path.dirname(path.dirname(require.resolve('@electric-sql/pglite'))),'dist');
 const {PGlite}=await import(pathToFileURL(path.join(dist,'index.js')).href);
 const wasmModule=await WebAssembly.compile(await fs.readFile(path.join(dist,'pglite.wasm')));
 const fsBundle=new Blob([await fs.readFile(path.join(dist,'pglite.data'))]);
 const db=new PGlite({wasmModule,fsBundle});await db.waitReady;
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 const migrations=[
  '202610300000_base_schema.sql',
  '202610310001_completion_details.sql',
  '202610310002_member_experience.sql',
  '202611070001_member_bike_services_shared.sql',
  '202611070002_idempotent_bike_import.sql',
  '202611070003_bike_service_soft_delete.sql',
  '202611070004_harden_privileges_and_bike_retention.sql',
  '202611070005_admin_pin_rate_limit.sql',
  '20261118_member_credentials_profiles.sql',
  '20261118_member_password_recovery_window.sql'
 ];
 let count=0;
 for(const name of migrations){await db.exec(await fs.readFile(path.join(root,'supabase/migrations',name),'utf8'));console.log('PASS fresh migration '+name);count++}
 const tables=(await db.query("select tablename from pg_tables where schemaname='public' and tablename like 'voltes_%'")).rows.map(x=>x.tablename);
 for(const name of ['voltes_rides','voltes_riders','voltes_signups','voltes_route_templates','voltes_admin_sessions','voltes_ride_admin_notes','voltes_bikes','voltes_bike_services','voltes_admin_login_attempts','voltes_member_credentials','voltes_member_sessions','voltes_member_login_attempts','voltes_member_password_resets'])assert.ok(tables.includes(name),'Missing '+name);
 console.log('PASS all thirteen base and private account tables');count++;

 const privateTables=['voltes_member_credentials','voltes_member_sessions','voltes_member_login_attempts','voltes_member_password_resets'];
 for(const table of privateTables){
  const r=(await db.query("select relrowsecurity from pg_class where oid=('public.'||$1)::regclass",[table])).rows[0];
  assert.equal(r?.relrowsecurity,true,'RLS must protect '+table);
  const denied=(await db.query("select has_table_privilege('anon',('public.'||$1)::text,'SELECT') as can_read",[table])).rows[0];
  assert.equal(denied.can_read,false,'No anon read access '+table);
 }
 console.log('PASS member credentials, sessions and throttles are private');count++;
 const signup=(await db.query("select public.voltes_member_register('Member Signup Test',repeat('a',64),repeat('b',32),210000) as id")).rows[0];
 assert.ok(signup.id,'Registration RPC creates account');
 const saved=(await db.query('select member_id,password_hash,salt from public.voltes_member_credentials where member_id=$1',[signup.id])).rows[0];
 assert.equal(saved?.password_hash,'a'.repeat(64));
 assert.equal(saved?.salt,'b'.repeat(32));
 let conflict=false;
 try{await db.query("select public.voltes_member_register('member signup test',repeat('a',64),repeat('b',32),210000)")}
 catch(e){conflict=String(e).includes('unique')||String(e).includes('duplicate');}
 assert.ok(conflict,'Duplicate names must be rejected regardless of letter case');
 console.log('PASS atomic account registration and case-insensitive name protection');count++;
 const resetHash='f'.repeat(64);
 await db.query(
  "insert into public.voltes_member_password_resets(member_id,reset_token_hash,expires_at) values($1,$2,now()+interval '1 hour')",
  [signup.id,resetHash]
 );
 const ticket=(await db.query(
  "select expires_at>now() as active from public.voltes_member_password_resets where member_id=$1",
  [signup.id]
 )).rows[0];
 assert.equal(ticket?.active,true,'Reset approval must be time limited and initially valid');
 const recovered=await db.query(
  'select public.voltes_member_consume_password_reset($1,$2,$3,$4,$5) as done',
  [signup.id,resetHash,'c'.repeat(64),'d'.repeat(32),210000]
 );
 assert.equal(recovered.rows[0].done,true,'Valid recovery code must work');
 const newCredentials=(await db.query(
  'select password_hash from public.voltes_member_credentials where member_id=$1',[signup.id]
 )).rows[0];
 assert.equal(newCredentials?.password_hash,'c'.repeat(64),'New credential hash must be stored');
 const reused=(await db.query(
  'select public.voltes_member_consume_password_reset($1,$2,$3,$4,$5) as done',
  [signup.id,resetHash,'a'.repeat(64),'b'.repeat(32),210000]
 )).rows[0];
 assert.equal(reused.done,false,'Reset code cannot be used twice');
 await db.query(
  "insert into public.voltes_member_password_resets(member_id,reset_token_hash,expires_at) values($1,$2,now()-interval '1 second')",
  [signup.id,'e'.repeat(64)]
 );
 const expired=(await db.query(
  'select public.voltes_member_consume_password_reset($1,$2,$3,$4,$5) as done',
  [signup.id,'e'.repeat(64),'a'.repeat(64),'b'.repeat(32),210000]
 )).rows[0];
 assert.equal(expired.done,false,'Reset code expires after the approved window');
 const stillValid=(await db.query(
  'select password_hash from public.voltes_member_credentials where member_id=$1',[signup.id]
 )).rows[0];
 assert.equal(stillValid.password_hash,'c'.repeat(64),'Failed recovery must never replace the password');
 console.log('PASS one-hour reset window, expired tokens, one-time atomic password reset');count++;
 const gateKey='d'.repeat(64);
 for(let i=0;i<7;i++){
  const r=(await db.query('select public.voltes_member_login_gate($1,false) as allowed',[gateKey])).rows[0];
  assert.equal(r.allowed,false);
 }
 const blocked=(await db.query('select public.voltes_member_login_gate($1,true) as allowed',[gateKey])).rows[0];
 assert.equal(blocked.allowed,false,'Correct code cannot bypass temporary login cooldown');
 const fresh=(await db.query('select public.voltes_member_login_gate($1,true) as allowed',['e'.repeat(64)])).rows[0];
 assert.equal(fresh.allowed,true,'Other member may sign in normally');
 console.log('PASS seven wrong passwords trigger server-enforced cooldown');count++;
 const member='12345678-1234-1234-1234-123456789abc',template='12345678-1234-1234-1234-123456789abd';
 await db.query('insert into public.voltes_riders(id,name,member) values($1,$2,true)',[member,'Member One']);
 await db.query('insert into public.voltes_route_templates(id,name,points,route_type,estimate) values($1,$2,$3::jsonb,$4,$5)',[template,'Lake Loop',JSON.stringify(['Start','Finish']),'flat',31]);
 await db.query('insert into public.voltes_rides(date,time,place,title,done,attendees,route_template_id) values($1,$2,$3,$4,true,$5::jsonb,$6)',['2026-09-30','09:00','Lake','Group Test',JSON.stringify(['Member One','Guest Rider']),template]);
 let guest=(await db.query('select member from public.voltes_riders where name=$1',['Guest Rider'])).rows[0];
 assert.equal(guest.member,false);console.log('PASS completed ride auto-registers guest');count++;
 await db.query('delete from public.voltes_route_templates where id=$1',[template]);
 const ride=(await db.query('select route_template_id from public.voltes_rides limit 1')).rows[0];
 assert.equal(ride.route_template_id,null);console.log('PASS route deletion preserves ride');count++;
 const publicGrants=await db.query("select has_function_privilege('anon','public.voltes_register_completed_ride_visitors()','execute') as trigger,has_function_privilege('anon','public.voltes_admin_login_gate(text,boolean)','execute') as gate");
 assert.equal(publicGrants.rows[0].trigger,false);assert.equal(publicGrants.rows[0].gate,false);console.log('PASS public privileged RPCs blocked');count++;
 await db.exec('set role anon');
 await assert.rejects(()=>db.query('select * from public.voltes_route_templates'),e=>e.code==='42501');
 await assert.rejects(()=>db.query('select * from public.voltes_bike_services'),e=>e.code==='42501');
 console.log('PASS publicly exposed tables denied direct access');count++;
 await db.exec('reset role');await db.close();
 console.log(count+' fresh installation checks passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
