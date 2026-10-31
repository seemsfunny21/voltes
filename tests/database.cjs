const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
async function main(){
 const root=path.resolve(__dirname,'..');
 const packageDir=process.argv[2]?path.resolve(process.argv[2]):path.dirname(path.dirname(require.resolve('@electric-sql/pglite')));
 const dir=path.join(packageDir,'dist');
 const {PGlite}=await import(pathToFileURL(path.join(dir,'index.js')).href);
 const wasmModule=await WebAssembly.compile(await fs.readFile(path.join(dir,'pglite.wasm')));
 const fsBundle=new Blob([await fs.readFile(path.join(dir,'pglite.data'))]);
 let checks=0;
 for(const arrayType of ['jsonb','text[]']){
 const db=new PGlite({wasmModule,fsBundle});await db.waitReady;
 const first='12345678-1234-1234-1234-123456789abc',second='12345678-1234-1234-1234-123456789abd';
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create table voltes_rides(id uuid primary key,done boolean default false,km numeric,speed numeric,attendees ${arrayType},slowed ${arrayType},strava text);
 create table voltes_riders(name text unique,member boolean);
 create table voltes_signups(ride_id uuid references voltes_rides(id),name text);
 grant all on voltes_rides,voltes_riders to service_role;
 insert into voltes_rides(id,done,km) values ('${first}',true,35),('${second}',false,null);`);
 await db.exec(await fs.readFile(path.join(root,'supabase/migrations/202610310001_completion_details.sql'),'utf8'));
 assert.equal((await db.query('select moving_minutes from voltes_rides where id=$1',[first])).rows[0].moving_minutes,null);checks++;
 const details={km:35,speed:21,attendees:['Αλέξης'],slowed:['Αλέξης'],strava:'',elevation_gain_m:120,moving_minutes:100,slowdown_notes:'private'};
 await db.exec('set role service_role');
 await db.query('select voltes_finish_ride($1,$2::jsonb)',[second,JSON.stringify(details)]);
 const ride=(await db.query('select * from voltes_rides where id=$1',[second])).rows[0];
 assert.equal(ride.done,true);assert.equal(ride.moving_minutes,100);assert.equal(ride.elevation_gain_m,120);assert.deepEqual(ride.attendees,['Αλέξης']);checks++;
 assert.equal((await db.query('select name from voltes_riders')).rows[0].name,'Αλέξης');checks++;
 assert.equal((await db.query('select slowdown_notes from voltes_ride_admin_notes')).rows[0].slowdown_notes,'private');checks++;
 await assert.rejects(()=>db.query('select voltes_finish_ride($1,$2::jsonb)',[second,JSON.stringify(details)]),e=>e.code==='P0002');checks++;
 await db.exec('reset role; set role anon');
 await assert.rejects(()=>db.query('select * from voltes_ride_admin_notes'),e=>e.code==='42501');checks++;
 for(const table of ['voltes_rides','voltes_riders','voltes_signups']){await assert.rejects(()=>db.query('select * from '+table),e=>e.code==='42501');checks++}
 await assert.rejects(()=>db.query('select voltes_finish_ride($1,$2::jsonb)',[second,JSON.stringify(details)]),e=>e.code==='42501');checks++;
 await db.exec('reset role; set role authenticated');
 await assert.rejects(()=>db.query('select * from voltes_ride_admin_notes'),e=>e.code==='42501');checks++;
 await db.exec('reset role');
 await db.query('delete from voltes_rides where id=$1',[second]);assert.equal((await db.query('select * from voltes_ride_admin_notes')).rows.length,0);checks++;
 await db.query('insert into voltes_rides(id) values($1)',[second]);
 await assert.rejects(()=>db.query('select voltes_finish_ride($1,$2::jsonb)',[second,JSON.stringify({...details,moving_minutes:0})]));
 assert.equal((await db.query('select done from voltes_rides where id=$1',[second])).rows[0].done,false);checks++;
 await db.exec(`create function reject_rider() returns trigger language plpgsql as $$begin raise exception 'Simulated rider failure';end;$$;
 create trigger reject_rider before insert on voltes_riders for each row execute function reject_rider();`);
 await assert.rejects(()=>db.query('select voltes_finish_ride($1,$2::jsonb)',[second,JSON.stringify({...details,attendees:['Rollback rider'],slowed:[]})]));
 assert.equal((await db.query('select done from voltes_rides where id=$1',[second])).rows[0].done,false);assert.equal((await db.query('select * from voltes_ride_admin_notes')).rows.length,0);checks++;
 await db.close();console.log('PASS PostgreSQL migration, permissions, atomicity: '+arrayType);
 }
 console.log(checks+' database checks passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
