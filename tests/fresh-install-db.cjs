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
  '202611070005_admin_pin_rate_limit.sql'
 ];
 let count=0;
 for(const name of migrations){await db.exec(await fs.readFile(path.join(root,'supabase/migrations',name),'utf8'));console.log('PASS fresh migration '+name);count++}
 const tables=(await db.query("select tablename from pg_tables where schemaname='public' and tablename like 'voltes_%'")).rows.map(x=>x.tablename);
 for(const name of ['voltes_rides','voltes_riders','voltes_signups','voltes_route_templates','voltes_admin_sessions','voltes_ride_admin_notes','voltes_bikes','voltes_bike_services','voltes_admin_login_attempts'])assert.ok(tables.includes(name),'Missing '+name);
 console.log('PASS all nine base tables');count++;
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
