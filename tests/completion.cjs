const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
async function run(root){
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name)};
const common={URL};vm.createContext(common);vm.runInContext(read('completion.js'),common);
const {validateCompletion:validate,formatMovingTime:format}=common.VoltesCompletion;
const input={km:'35',speed:'21',elevationGain:'120',movingTime:'1:40',attendees:['Αλέξης'],slowed:[],slowdownNotes:'',strava:''};
check('moving time conversion and zero elevation',()=>{assert.equal(validate(input).movingMinutes,100);assert.equal(validate({...input,elevationGain:'0'}).elevationGain,0);assert.equal(format(100),'1:40');assert.equal(format(1500),'25:00')});
for(const movingTime of ['1:60','1:5','-1:30','0:00','12','1000:00'])check('reject time '+movingTime,()=>assert.throws(()=>validate({...input,movingTime})));
for(const elevationGain of ['',null,-1,1.2,50001,'Infinity'])check('reject elevation '+elevationGain,()=>assert.throws(()=>validate({...input,elevationGain})));
check('require actual participants',()=>assert.throws(()=>validate({...input,attendees:[]})));
check('slowdown only for attendees',()=>assert.throws(()=>validate({...input,slowed:['Άλλος']})));
check('deduplicate participants',()=>assert.equal(validate({...input,attendees:['Αλέξης','Αλέξης']}).attendees.length,1));
check('private notes limit',()=>assert.throws(()=>validate({...input,slowdownNotes:'x'.repeat(2001)})));
check('Strava URL validation',()=>{assert.throws(()=>validate({...input,strava:'javascript:alert(1)'}));assert.throws(()=>validate({...input,strava:'https://strava.com.evil.test/'}));assert.equal(validate({...input,strava:'https://www.strava.com/activities/123'}).strava,'https://www.strava.com/activities/123')});
check('shared browser and server validation match',()=>assert.equal(read('completion.js'),read('supabase/functions/_shared/completion.js')));
const {createHash,webcrypto}=require('node:crypto');
const hash=v=>createHash('sha256').update(v).digest('hex');
const token='a'.repeat(64);
const id='12345678-1234-1234-1234-123456789abc';
const ride={id,date:'2026-10-31',time:'09:00',place:'Λίμνη',title:'Γύρος',done:true,km:35,speed:21,elevation_gain_m:120,moving_minutes:100,attendees:['Αλέξης'],slowed:['Αλέξης'],strava:''};
const tables={
 voltes_rides:[ride],voltes_riders:[{name:'Αλέξης',member:true,avatar_data_url:null}],
 voltes_ride_admin_notes:[{ride_id:id,slowdown_notes:'PRIVATE_NOTE'}],
 voltes_signups:[{ride_id:id,name:'Αλέξης',cancel_token_hash:null}],
 voltes_route_templates:[],
 voltes_admin_sessions:[{token_hash:hash(token),pin_version:hash('test:1234')}]
};
let calls=[],rpcError=null,handler;
function query(table){
 calls.push(table);let filters=[],single=false;
 const q={select(){return q},order(){return q},eq(k,v){filters.push([k,v]);return q},is(k,v){filters.push([k,v]);return q},limit(){return q},single(){single=true;return q},maybeSingle(){single=true;return q},insert(){return q},update(){return q},delete(){return q},then(resolve,reject){
  const matched=(tables[table]||[]).filter(row=>filters.every(([k,v])=>row[k]===v));
  return Promise.resolve({data:single?(matched[0]||null):matched,error:null}).then(resolve,reject);
 }};return q;
}
const database={from:query,async rpc(name,args){calls.push({name,args});return {error:rpcError}}};
const ctx={URL,Request,Response,console,crypto:webcrypto,TextEncoder,AbortSignal,Intl,Deno:{env:{get:key=>key==='ADMIN_PIN'?'1234':'test'},serve:fn=>handler=fn},createClient:()=>database};
vm.createContext(ctx);vm.runInContext(read('completion.js'),ctx);
let server=read('supabase/functions/rapid-responder/index.ts').replace(/^import .*;$/gm,'');
server=require('node:module').stripTypeScriptTypes(server);
vm.runInContext(server,ctx);
async function request(body){return handler(new Request('https://test.local',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}))}
calls=[];let response=await request({action:'state'}),publicState=await response.json();
check('anonymous state hides identities and admin notes',()=>{assert.equal(response.status,200);assert.equal(publicState.admin,false);assert.equal(JSON.stringify(publicState).includes('PRIVATE_NOTE'),false);for(const key of ['attendees','slowed','slowdownNotes','signups','speed'])assert.equal(key in publicState.rides[0],false);assert.equal(calls.includes('voltes_ride_admin_notes'),false);assert.equal(publicState.rides[0].movingMinutes,100)});
response=await request({action:'state',adminToken:token});const privateState=await response.json();
check('admin token sees private notes and capability',()=>{assert.equal(privateState.rides[0].slowdownNotes,'PRIVATE_NOTE');assert.equal(privateState.capabilities.rideCompletionV2,true)});
response=await request({action:'finish',id,...validate(input)});
check('finish requires saved Admin authorization',()=>assert.equal(response.status,403));
response=await request({action:'finish',pin:'1234',id,...validate(input)});
check('raw PIN cannot bypass Admin login',()=>assert.equal(response.status,403));
calls=[];response=await request({action:'finish',adminToken:token,id,...validate(input),slowdownNotes:'Private'});
check('finish uses single atomic RPC',()=>{assert.equal(response.status,200);const rpc=calls.filter(x=>typeof x==='object');assert.equal(rpc.length,1);assert.equal(rpc[0].name,'voltes_finish_ride');assert.equal(rpc[0].args.p_details.moving_minutes,100);assert.equal(rpc[0].args.p_details.elevation_gain_m,120);assert.equal(rpc[0].args.p_details.slowdown_notes,'Private')});
calls=[];response=await request({action:'finish',adminToken:token,id,...validate(input),movingMinutes:1.5});
check('invalid completion never reaches mutation RPC',()=>{assert.equal(response.status,400);assert.equal(calls.filter(x=>typeof x==='object').length,0)});
rpcError={code:'P0002'};response=await request({action:'finish',adminToken:token,id,...validate(input)});
check('repeat completion returns conflict',()=>assert.equal(response.status,409));
let events={};const elements={};const el=()=>({innerHTML:'',textContent:'',classList:{add(){},toggle(){},contains(){return false}},setAttribute(){},querySelectorAll(){return []},querySelector(){return null},scrollTo(){},addEventListener(event,fn){events[event]=fn}});
for(const selector of ['#app','#nav','#menuBtn','#adminNav','#authBtn','#bottomNav','.shell'])elements[selector]=el();
const browser={URL,console,localStorage:{getItem(){return null},setItem(){},removeItem(){}},window:{VOLTES_API_URL:'https://test.local',scrollTo(){}},location:{protocol:'file:'},navigator:{},sessionStorage:{getItem(){return ''},setItem(){},removeItem(){}},document:{documentElement:{dataset:{}},querySelector:s=>elements[s]},fetch:async()=>({ok:true,json:async()=>privateState})};
vm.createContext(browser);vm.runInContext(read('completion.js'),browser);vm.runInContext(read('app.js'),browser);await new Promise(resolve=>setTimeout(resolve,0));
vm.runInContext('admin=true;completionV2=true;db='+JSON.stringify(privateState)+';',browser);
const form=vm.runInContext('finish(db.rides[0])',browser);
check('completion form preserves fields and adds measurements',()=>{for(const name of ['km','speed','strava','elevationGain','movingTime','person','slowed','slowdownNotes'])assert.ok(form.includes('name="'+name+'"'));assert.ok(!form.includes('button class="btn" disabled'))});
check('old backend cannot silently discard new fields',()=>{vm.runInContext('completionV2=false',browser);assert.ok(vm.runInContext('finish(db.rides[0])',browser).includes('button class="btn" disabled'))});
check('private notes render escaped for admin only',()=>{vm.runInContext('db.rides[0].slowdownNotes="<script>private</script>"',browser);assert.ok(vm.runInContext('rideCard(db.rides[0])',browser).includes('&lt;script&gt;'));vm.runInContext('admin=false',browser);assert.equal(vm.runInContext('rideCard(db.rides[0])',browser).includes('private'),false)});
check('legacy history measurements remain unknown',()=>{vm.runInContext('db.rides[0].elevationGain=null;db.rides[0].movingMinutes=null',browser);assert.ok(vm.runInContext('rideCard(db.rides[0])',browser).includes('Χρόνος κίνησης: —'))});
return count;
}
module.exports=run;
if(require.main===module)run(path.resolve(__dirname,'..')).then(n=>console.log(n+' checks passed')).catch(e=>{console.error(e);process.exitCode=1});
