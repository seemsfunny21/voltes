'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
async function main(){
 const root=path.resolve(__dirname,'..');
 const moduleRoot=path.dirname(path.dirname(require.resolve('@electric-sql/pglite')));
 const dir=path.join(moduleRoot,'dist');
 const {PGlite}=await import(pathToFileURL(path.join(dir,'index.js')).href);
 const wasmModule=await WebAssembly.compile(await fs.readFile(path.join(dir,'pglite.wasm')));
 const fsBundle=new Blob([await fs.readFile(path.join(dir,'pglite.data'))]);
 const db=new PGlite({wasmModule,fsBundle});await db.waitReady;
 let n=0;const check=async(label,fn)=>{await fn();n++;console.log('PASS '+label)};
 const read=filename=>fs.readFile(path.join(root,'supabase/migrations',filename),'utf8');
 const member='12345678-1234-1234-1234-123456789abc';
 const bike='12345678-1234-1234-1234-123456789abd';
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create table public.voltes_riders(id uuid primary key,name text not null,member bool not null);
  create table public.voltes_rides(id uuid primary key,route_template_id uuid);
  create function public.voltes_register_completed_ride_visitors() returns trigger language plpgsql security definer as $$ begin return new; end; $$;
  grant execute on function public.voltes_register_completed_ride_visitors() to public;
  insert into public.voltes_riders(id,name,member) values ('${member}','Member A',true);`);
 for(const name of ['202611070001_member_bike_services_shared.sql','202611070002_idempotent_bike_import.sql','202611070003_bike_service_soft_delete.sql','202611070004_harden_privileges_and_bike_retention.sql','202611070005_admin_pin_rate_limit.sql']){
  await db.exec(await read(name));n++;console.log('PASS migration '+name);
 }
 await check('anonymous users cannot directly read bikes',async()=>{
  await db.exec('set role anon');
  await assert.rejects(()=>db.query('select * from public.voltes_bikes'),e=>e.code==='42501');
  await db.exec('reset role');
 });
 await check('privileged trigger is not available as public RPC',async()=>{
  const {rows}=await db.query("select has_function_privilege('anon','public.voltes_register_completed_ride_visitors()','execute') as allowed");
  assert.equal(rows[0].allowed,false);
 });
 await check('Admin PIN limiter is not callable by anonymous users',async()=>{
  const {rows}=await db.query("select has_function_privilege('anon','public.voltes_admin_login_gate(text,boolean)','execute') as allowed");
  assert.equal(rows[0].allowed,false);
 });
 await db.query('insert into public.voltes_bikes(id,member_id,name,is_default) values($1,$2,$3,true)',[bike,member,'Bike A']);
 await check('only one default bicycle per member',async()=>{
  await assert.rejects(()=>db.query('insert into public.voltes_bikes(member_id,name,is_default) values($1,$2,true)',[member,'Bike B']),e=>e.code==='23505');
 });
 await check('deleting member cannot destroy bicycle history',async()=>{
  await assert.rejects(()=>db.query('delete from public.voltes_riders where id=$1',[member]),e=>e.code==='23503');
  assert.equal((await db.query('select count(*)::int n from public.voltes_bikes')).rows[0].n,1);
 });
 const service='12345678-1234-1234-1234-123456789abe';
 await db.query('insert into public.voltes_bike_services(id,bike_id,service_date,work,notes,import_fingerprint) values($1,$2,$3,$4,$5,$6)',[service,bike,'2026-09-30','Λάστιχα','Tubeless','a'.repeat(64)]);
 await db.query('update public.voltes_bike_services set deleted_at=now() where id=$1',[service]);
 await check('deleted service is retained as small tombstone',async()=>{
  assert.equal((await db.query('select count(*)::int n from public.voltes_bike_services where deleted_at is null')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from public.voltes_bike_services')).rows[0].n,1);
 });
 await check('old device cannot reimport previously deleted fingerprint',async()=>{
  await assert.rejects(()=>db.query('insert into public.voltes_bike_services(bike_id,service_date,work,import_fingerprint) values($1,$2,$3,$4)',[bike,'2026-09-30','Λάστιχα','a'.repeat(64)]),e=>e.code==='23505');
 });
 await db.exec('set role service_role');
 const key='f'.repeat(64);
 for(let i=0;i<6;i++)await db.query('select public.voltes_admin_login_gate($1,false)',[key]);
 await check('six failed PINs trigger temporary lock',async()=>{
  const {rows}=await db.query('select failures,blocked_until>now() as blocked from public.voltes_admin_login_attempts where key_hash=$1',[key]);
  assert.equal(rows[0].failures,6);assert.equal(rows[0].blocked,true);
 });
 await check('correct PIN remains blocked during lockout',async()=>{
  const {rows}=await db.query('select public.voltes_admin_login_gate($1,true) as allowed',[key]);
  assert.equal(rows[0].allowed,false);
 });
 await check('fresh client may authenticate after correct PIN',async()=>{
  const {rows}=await db.query('select public.voltes_admin_login_gate($1,true) as allowed',['b'.repeat(64)]);
  assert.equal(rows[0].allowed,true);
 });
 await db.exec('reset role');
 await db.close();
 console.log(n+' long-term database checks passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
