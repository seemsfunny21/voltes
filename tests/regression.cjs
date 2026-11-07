'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name)}
async function main(){
 for(const file of ['app.js','completion.js','strava-ocr.js','sw.js']){
  test(file+' JavaScript syntax',()=>assert.doesNotThrow(()=>new vm.Script(read(file),{filename:file})));
 }
 const html=read('index.html'),sw=read('sw.js'),app=read('app.js'),backend=read('supabase/functions/rapid-responder/index.ts');
 test('PWA references match cache assets',()=>{
  const assets=[...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]+)?)"/g)].map(m=>m[1]);
  for(const asset of assets)assert.ok(sw.includes("'./"+asset+"'"),'Missing cache asset '+asset);
 });
 test('main backend source has current routes',()=>{for(const name of ['addHistoricalRide','editCompletedRide','editRoute','saveRoute','deleteRider','voltes_admin_login_gate'])assert.ok(backend.includes(name))});
 test('service history has no old manual import panel',()=>assert.ok(!app.includes('importBikeLegacy')&&!app.includes('Μεταφορά παλιών στοιχείων')));
 test('user interface contains service actions',()=>assert.ok(app.includes('+ Νέο σέρβις')&&app.includes('Προβολή παλιών σέρβις')));
 const used=new Set([...app.matchAll(/data-do=["']([\w-]+)["']/g)].map(x=>x[1]));
 const handlers=new Set([...app.matchAll(/case '([\w-]+)'/g),...app.matchAll(/b\.dataset\.do===['"]([\w-]+)['"]/g)].map(x=>x[1]));
 test('every rendered action has a handler',()=>{for(const action of used)assert.ok(handlers.has(action),'Missing handler '+action)});
 const events={},storage=new Map([['voltesChosenMember','Μέλος Α']]);
 const el=()=>({innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){},contains(){return false}},dataset:{},setAttribute(){},addEventListener(n,fn){events[n]=fn},querySelectorAll(){return []},querySelector(){return null},scrollTo(){},focus(){}});
 const elements={};for(const id of ['#app','#nav','#bottomNav','#adminNav','#authBtn','.shell'])elements[id]=el();
 const dom={documentElement:{dataset:{}},querySelector:s=>elements[s]||el(),querySelectorAll(){return []},addEventListener(){}};
 const requests=[];
 const fetchMock=async(url,opt)=>{
  const body=JSON.parse(opt.body);requests.push(body);
  const state=String(url).includes('/bike-services')?{bikes:[],services:[]}:{
   rides:[],routeTemplates:[],riders:[],members:2,admin:false,
   publicMembers:[{name:'Μέλος Α'},{name:'Μέλος Β'}],capabilities:{rideCompletionV2:true}
  };
  return {ok:true,json:async()=>body.action==='state'?state:{ok:true,imported:false}};
 };
 const ctx={console,Date,URL,FormData,Intl,crypto:require('node:crypto').webcrypto,Request,Response,
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
  sessionStorage:{removeItem(){},getItem(){return null}},
  window:{VOLTES_API_URL:'https://example.supabase.co/functions/v1/rapid-responder',scrollTo(){},innerWidth:375},
  document:dom,navigator:{},location:{protocol:'file:'},fetch:fetchMock,
  HTMLInputElement:class {},confirm:()=>true,createImageBitmap:async()=>{throw Error('No image fixture')}};
 vm.createContext(ctx);
 vm.runInContext(read('completion.js'),ctx);
 vm.runInContext(app,ctx);
 await new Promise(resolve=>setTimeout(resolve,5));
 vm.runInContext("db={rides:[],riders:[],routeTemplates:[],members:2,publicMembers:[{name:'Μέλος Α'},{name:'Μέλος Β'}]}",ctx);
 vm.runInContext("bikeCloud={loaded:true,member:'Μέλος Α',bikes:[{id:'a',name:'Bike A',member_name:'Μέλος Α',is_default:true},{id:'b',name:'Bike B',member_name:'Μέλος Β',is_default:true}],services:[{id:'s1',bike_id:'a',work:'Λάστιχα',service_date:'2026-09-30',notes:'Tubeless',km:0},{id:'s2',bike_id:'b',work:'Άλλη εργασία',service_date:'2026-10-01',notes:'PrivateB',km:10}]}",ctx);
 const renderHistory=()=>vm.runInContext("bikeServicePage('history')",ctx);
 test('member A sees only member A history',()=>{const v=renderHistory();assert.ok(v.includes('Tubeless'));assert.ok(!v.includes('PrivateB'));assert.ok(!v.includes('Bike B'))});
 storage.set('voltesChosenMember','Μέλος Β');
 test('member B sees only member B history',()=>{const v=renderHistory();assert.ok(v.includes('PrivateB'));assert.ok(!v.includes('Tubeless'))});
 storage.set('voltesChosenMember','Μέλος Α');
 test('service edit and delete controls render',()=>{const v=renderHistory();assert.ok(v.includes('Διόρθωση')&&v.includes('Διαγραφή'))});
 vm.runInContext("bikeCloud.services[0].notes='<script>alert(1)</script>'",ctx);
 test('service text is HTML escaped',()=>assert.ok(!renderHistory().includes('<script>')&&renderHistory().includes('&lt;script&gt;')));
 test('settings have exactly two service actions',()=>{const v=vm.runInContext('themeSettings()',ctx);assert.equal((v.match(/data-go="bikeService"/g)||[]).length,1);assert.equal((v.match(/data-go="bikeHistory"/g)||[]).length,1)});
 await vm.runInContext('bikeLastFetch=0;autoSyncBikeCloud()',ctx);
 const before=requests.length;
 await vm.runInContext('autoSyncBikeCloud()',ctx);
 test('repeat service visit does not refetch within one minute',()=>assert.equal(requests.length,before));
 console.log(checks+' frontend regression checks passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
