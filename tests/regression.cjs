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
 test('bike equipment API and screen are present',()=>{
  const api=read('supabase/functions/bike-services/index.ts');
  assert.ok(app.includes('data-go="bikeDetails"')&&app.includes('saveBikeDetails')&&api.includes("action==='saveBikeDetails'")&&api.includes('bike_details'));
 });
 test('member password recovery UI offers both self-change and Admin-approved reset',()=>{
   const accounts=read('supabase/functions/member-accounts/index.ts');
   const migration=read('supabase/migrations/20261118_member_password_recovery_window.sql');
   assert.ok(app.includes('memberPasswordForm')&&app.includes('memberRecoveryForm'));
   assert.ok(app.includes('adminMemberReset')&&app.includes('memberCredentialIds'));
   assert.ok(app.includes("memberApi('adminIssueReset'")&&app.includes("memberApi('resetPassword'"));
   assert.ok(accounts.includes("action==='adminIssueReset'")&&accounts.includes("action==='resetPassword'"));
   assert.ok(accounts.includes("action==='adminAccountStates'"));
   assert.ok(accounts.includes('await adminAuthorized(p.adminToken)'));
   assert.ok(accounts.includes('voltes_member_consume_password_reset'));
   assert.ok(accounts.includes("if(already)return bad("),'Admin cannot silently overwrite an activated password');
   assert.ok(migration.includes('expires_at>now()')&&migration.includes('return false'));
   assert.ok(migration.includes('delete from public.voltes_member_sessions'),'Reset revokes older sessions');
   assert.ok(migration.includes('revoke all on public.voltes_member_password_resets'));
 });
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
 vm.runInContext("memberAccount={id:'a',name:'Μέλος Α'};memberToken='"+'1'.repeat(64)+"';bikeCloud={loaded:true,member:'Μέλος Α',bikes:[{id:'a',name:'Bike A',member_name:'Μέλος Α',is_default:true},{id:'b',name:'Bike B',member_name:'Μέλος Β',is_default:true}],services:[{id:'s1',bike_id:'a',work:'Λάστιχα',service_date:'2026-09-30',notes:'Tubeless',km:0},{id:'s2',bike_id:'b',work:'Άλλη εργασία',service_date:'2026-10-01',notes:'PrivateB',km:10}]}",ctx);
 const renderHistory=()=>vm.runInContext("bikeServicePage('history')",ctx);

 test('member directory back link follows entry section',()=>{for(const [origin,label] of [['members','Το προφίλ μου'],['more','Περισσότερα'],['communityGame','Κατάταξη']]){vm.runInContext("memberDirectoryOrigin="+JSON.stringify(origin),ctx);const v=vm.runInContext('publicMembers()',ctx);assert.ok(v.includes('data-go="'+origin+'" aria-label="Επιστροφή"'))}vm.runInContext("memberDirectoryOrigin='members'",ctx)});
 test('legacy bootstrap screen requires a new personal password before session',()=>{vm.runInContext("bootstrapMemberName='Μέλος Β'",ctx);const v=vm.runInContext('memberBootstrapPage()',ctx);assert.ok(v.includes('memberBootstrapForm')&&v.includes('Μέλος Β')&&v.includes('name="newPassword"')&&v.includes('minlength="6"'));vm.runInContext("bootstrapMemberName=''",ctx)});
 test('five bottom tabs separate shopping, sport and more',()=>{assert.deepEqual([...html.matchAll(/data-bottom-route="([^"]+)"/g)].map(m=>m[1]),['home','members','activityGame','sportGame','menu']);const more=vm.runInContext('gameMorePage()',ctx);assert.ok(more.includes('data-go="history"')&&more.includes('data-go="settings"'))});
 const gameFixture={ok:true,status:'approved',coins:1000,xp:200,style:'blue',appearance:{},owned:['helmet'],totals:{bike:30},rates:[{sport:'bike',rate:10,daily_cap:200},{sport:'run',rate:30,daily_cap:50},{sport:'walk',rate:20,daily_cap:30},{sport:'gym',rate:10,daily_cap:180}],activities:[],groups:[],gifts:[{id:'gf',item:'gift',sender:'Μέλος Β',visible:false}],catalog:[{id:'helmet',name:'Κράνος',category:'Εξοπλισμός',icon:'⛑',price:400},{id:'pred_color_purple',name:'Μωβ',category:'Χρώματα',source_category:'color',icon:'🟣',price:500},{id:'gift',name:'Λουλούδι',category:'Δώρα',source_category:'gift',icon:'🌷',price:50}],members:[{id:'a',name:'Μέλος Α',coins:1000,xp:200,owned:['helmet'],appearance:{},totals:{bike:30},gifts:[]},{id:'b',name:'Μέλος Β',coins:1000,xp:0,owned:[],appearance:{},totals:{},gifts:[]}],multipliers:[{people:1,multiplier:1},{people:2,multiplier:2},{people:3,multiplier:4},{people:4,multiplier:6}],messages:[],plans:[]};
 ctx.gameFixture=gameFixture;vm.runInContext("gameData=gameFixture;gameOwner=memberToken;route='members'",ctx);
 test('team directory opens every member profile with no obsolete self badge and keeps original ride history',()=>{vm.runInContext("route='memberDirectory';directorySelectedName='';db.publicMembers[1].activityCount=3;db.publicMembers[1].activityTotal=7;db.publicMembers[1].activityKm=90",ctx);const list=vm.runInContext('publicMembers()',ctx);assert.equal((list.match(/data-game="directoryProfile"/g)||[]).length,2);assert.ok(!list.includes('✓ Εσύ')&&!list.includes('Το προφίλ μου</button>'));vm.runInContext("directorySelectedName='Μέλος Β'",ctx);const v=vm.runInContext('publicMembers()',ctx);assert.ok(v.includes('data-game="directoryBack"')&&v.includes('Η καθημερινότητά μου')&&v.includes('3/7')&&v.includes('90'));assert.ok(!v.includes('Κρυφό')&&!v.includes('PrivateB'));vm.runInContext("directorySelectedName='';route='members'",ctx)});
 test('personal profile shows identity, bicycle tools, lifestyle and own gifts',()=>{const v=vm.runInContext('memberHub()',ctx);assert.ok(v.includes('Η καθημερινότητά μου')&&v.includes('Τα δώρα μου')&&v.includes('Κρυφό')&&v.includes('Κράνος')&&v.includes('data-go="bikeDetails"'));assert.ok(!v.includes('Καταχώριση δραστηριότητας'))});
 test('shop root shows two groups and filters cosmetic and lifestyle products exclusively',()=>{vm.runInContext("route='activityGame';gameStoreGroup='';gameStoreFilter='';gamePreviewItem=''",ctx);let v=vm.runInContext('gameActivityPage()',ctx);assert.ok(v.includes('Η καθημερινότητα')&&v.includes('Εξατομίκευση προφίλ'));assert.equal((v.match(/data-game="shopGroup"/g)||[]).length,2);assert.ok(!v.includes('data-game="category"'));vm.runInContext("gameStoreGroup='profile'",ctx);v=vm.runInContext('gameActivityPage()',ctx);assert.ok(v.includes('Χρώματα')&&!v.includes('Εξοπλισμός'));vm.runInContext("gameStoreFilter='Χρώματα'",ctx);v=vm.runInContext('gameActivityPage()',ctx);assert.ok(v.includes('Μωβ')&&!v.includes('Κράνος'));vm.runInContext("gameStoreGroup='life';gameStoreFilter='Εξοπλισμός'",ctx);v=vm.runInContext('gameActivityPage()',ctx);assert.ok(v.includes('Κράνος')&&!v.includes('Μωβ'));vm.runInContext("gameStoreGroup='';gameStoreFilter=''",ctx)});
 test('gifts have separate profile card and live preview uses a dialog without mutating balance or appearance',()=>{const p=vm.runInContext('memberProfilePage()',ctx);assert.ok(p.includes('game-profile-life')&&p.includes('game-profile-gifts')&&p.includes('</section><section class="card game-card game-profile-gifts"'));const v=vm.runInContext("gamePreview(gameData,gameData.catalog[1])",ctx);assert.ok(v.includes('<dialog')&&v.includes('game-color-purple')&&v.includes('#be91ff'));assert.equal(gameFixture.coins,1000);assert.equal(gameFixture.appearance.color,undefined)});
 test('shop only presents purchases and live preview does not mutate equipped appearance',()=>{vm.runInContext("route='activityGame';gameTab='shop';gamePreviewItem='pred_color_purple'",ctx);const v=vm.runInContext('gameActivityPage()',ctx);assert.ok(v.includes('Ζωντανή προεπισκόπηση')&&v.includes('Προεπισκόπηση χωρίς χρέωση'));assert.equal(gameFixture.appearance.color,undefined);assert.ok(!v.includes('gameActivityForm')&&!v.includes('gameGiftVisibility'))});
 test('sport shows group selection and reward preview without purchase controls',()=>{vm.runInContext("route='sportGame';gameTab='activity'",ctx);const v=vm.runInContext('gameActivityPage()',ctx);assert.ok(v.includes('gameGroupMode')&&v.includes('gameRewardPreview')&&v.includes('Μέλος Β'));assert.ok(!v.includes('data-game="buy"'))});
 test('gift recipient list shows other members, not a native dropdown, and excludes shop items',()=>{vm.runInContext("route='communityGame';gameTab='gift';gameRecipient='';gameStoreFilter='';gamePreviewItem=''",ctx);const v=vm.runInContext('gameActivityPage()',ctx);assert.ok(v.includes('game-gift-person')&&v.includes('data-target="b"')&&v.includes('Μέλος Β'));assert.ok(!v.includes('id="gameRecipient"')&&!v.includes('Κράνος')&&!v.includes('0/1 αποκτήματα'));assert.ok(v.includes('Λουλούδι'))});
 test('private message composer stays hidden until valid recipient selected',()=>{vm.runInContext("route='communityGame';gameTab='private';gameRecipient=''",ctx);assert.ok(!vm.runInContext('gameActivityPage()',ctx).includes('id="gameMessageForm"'));vm.runInContext("gameRecipient='b'",ctx);assert.ok(vm.runInContext('gameActivityPage()',ctx).includes('id="gameMessageForm"'));vm.runInContext("gameRecipient=''",ctx)});
 test('gifts have explicit visibility choice and member profile honors returned public gifts',()=>{vm.runInContext("route='communityGame';gameTab='gift'",ctx);const v=vm.runInContext('gameActivityPage()',ctx);assert.ok(v.includes('gameGiftVisibility')&&v.includes('Φανερό')&&v.includes('Κρυφό'));assert.ok(!vm.runInContext('gamePublicProfile(gameData.members[1])',ctx).includes('Λουλούδι'))});
 vm.runInContext("gameData=null;gameOwner='';gamePreviewItem='';route='home'",ctx);
 test('member A sees only member A history',()=>{const v=renderHistory();assert.ok(v.includes('Tubeless'));assert.ok(!v.includes('PrivateB'));assert.ok(!v.includes('Bike B'))});
 vm.runInContext("memberAccount={id:'b',name:'Μέλος Β'};memberToken='"+'1'.repeat(64)+"'",ctx);
 test('member B sees only member B history',()=>{const v=renderHistory();assert.ok(v.includes('PrivateB'));assert.ok(!v.includes('Tubeless'))});
 vm.runInContext("memberAccount={id:'a',name:'Μέλος Α'};memberToken='"+'1'.repeat(64)+"'",ctx);
 test('service edit and delete controls render',()=>{const v=renderHistory();assert.ok(v.includes('Διόρθωση')&&v.includes('Διαγραφή'))});
 vm.runInContext("bikeCloud.services[0].notes='<script>alert(1)</script>'",ctx);
 test('service text is HTML escaped',()=>assert.ok(!renderHistory().includes('<script>')&&renderHistory().includes('&lt;script&gt;')));
 test('bike tools live only in authenticated profile, not general settings',()=>{
  const settings=vm.runInContext('themeSettings()',ctx);
  const profile=vm.runInContext('memberHub()',ctx);
  for(const route of ['bikeService','bikeHistory','bikeMaintenance','bikeDetails']){
    assert.equal((settings.match(new RegExp('data-go="'+route+'"','g'))||[]).length,0,'No '+route+' inside settings');
    assert.equal((profile.match(new RegExp('data-go="'+route+'"','g'))||[]).length,1,'One '+route+' button in profile');
  }
  assert.ok(!profile.includes('data-go="memberDirectory"'),'Signed-in profile has no duplicate member directory button');
  assert.ok(vm.runInContext('gameMorePage()',ctx).includes('data-go="memberDirectory"'),'Member directory is accessible from More');
  assert.ok(!settings.includes('data-go="riders"')&&!settings.includes('data-go="new"'),
    'Non-admin settings have no privileged controls');
 });
 test('guest has clear login and member directory, but no private bike tools',()=>{
  vm.runInContext('memberAccount=null;memberToken=""',ctx);
  const hub=vm.runInContext('memberHub()',ctx);
  assert.ok(hub.includes('data-go="memberLogin"')&&hub.includes('data-go="memberRegister"'));
  assert.ok(!hub.includes('data-go="memberDirectory"'));
  assert.ok(!hub.includes('data-go="bikeService"'));
  vm.runInContext("memberAccount={id:'a',name:'Μέλος Α'};memberToken='"+'1'.repeat(64)+"'",ctx);
 });
 test('Admin settings retain all essential actions under organized sections',()=>{
  vm.runInContext('admin=true',ctx);
  const settings=vm.runInContext('themeSettings()',ctx);
  for(const action of ['new','riders','historyAdd','routeAdd','routes','stats','trash','backup']){
    assert.ok(settings.includes('data-go="'+action+'"'),'Admin action '+action+' still reachable');
  }
  assert.ok(settings.includes('data-do="downloadBackup"')&&settings.includes('data-do="adminLogout"'));
  vm.runInContext('admin=false',ctx);
 });
 vm.runInContext("bikeCloud.bikes[0].bike_details={tires:'Schwalbe Pro One TLE',frontBar:4.2,rearBar:4.6,wheelset:'<img src=x onerror=alert(1)>'};bikeCloud.bikes[1].bike_details={tires:'PRIVATE_B'}",ctx);
 const renderDetails=()=>vm.runInContext('bikeDetailsPage()',ctx);
 test('bike profile shows saved pressure and own equipment',()=>{const v=renderDetails();assert.ok(v.includes('Schwalbe Pro One TLE')&&v.includes('4,2 bar')&&v.includes('4,6 bar'));assert.ok(!v.includes('PRIVATE_B'))});
 test('bike profile escapes injected equipment HTML',()=>{const v=renderDetails();assert.ok(v.includes('&lt;img')&&!v.includes('<img src=x'))});
 test('bike editor uses existing clickable tiles rather than a duplicate form',()=>{
  vm.runInContext("bikeDetailsEditId='a';bikeDetailsFieldKey=''",ctx);
  const v=renderDetails();
  assert.ok(v.includes('data-do="pickBikeDetailsField"')&&v.includes('id="bikeDetailsAddSelect"'));
  assert.ok(!v.includes('id="bikeDetailsForm"')&&!v.includes('id="bikeDetailsFieldForm"'));
  assert.ok(!v.includes('name="frontBar"')&&!v.includes('name="tires"'));
 });
 test('selected pressure edits in place with exactly one input',()=>{
  vm.runInContext("bikeDetailsFieldKey='frontBar'",ctx);
  const v=renderDetails();
  assert.ok(v.includes('id="bikeDetailsFieldForm"')&&v.includes('data-field="frontBar"'));
  assert.ok(v.includes('name="value"')&&(v.match(/name="value"/g)||[]).length===1);
  assert.ok(!v.includes('data-field="rearBar" name="value"'));
 });
 test('selected component edits in place, other components stay visible',()=>{
  vm.runInContext("bikeDetailsFieldKey='tires'",ctx);
  const v=renderDetails();
  assert.ok(v.includes('data-field="tires"')&&v.includes('Schwalbe Pro One TLE'));
  assert.ok(v.includes('&lt;img')&&v.includes('name="value"'));
  assert.equal((v.match(/name="value"/g)||[]).length,1);
  vm.runInContext("bikeDetailsEditId='';bikeDetailsFieldKey=''",ctx);
 });
 vm.runInContext("memberAccount={id:'b',name:'Μέλος Β'};memberToken='"+'1'.repeat(64)+"'",ctx);
 test('bike profile does not leak another member equipment',()=>{const v=renderDetails();assert.ok(v.includes('PRIVATE_B'));assert.ok(!v.includes('Schwalbe Pro One TLE'))});
 vm.runInContext("memberAccount={id:'a',name:'Μέλος Α'};memberToken='"+'1'.repeat(64)+"'",ctx);
 await vm.runInContext('bikeLastFetch=0;autoSyncBikeCloud()',ctx);
 const before=requests.length;
 await vm.runInContext('autoSyncBikeCloud()',ctx);
 test('repeat service visit does not refetch within one minute',()=>assert.equal(requests.length,before));
 test('guest cannot claim an existing member by changing localStorage',()=>{
   const identity=vm.runInContext('memberName()',ctx);
   storage.set('voltesChosenMember','Μέλος Β');
   assert.equal(vm.runInContext('memberName()',ctx),identity);
 });
 test('new member password and session code is present',()=>{
   assert.ok(app.includes('memberRegisterForm')&&app.includes('memberLoginForm')&&
      app.includes('memberPasswordForm')&&app.includes('memberRemoveAvatar'));
   assert.ok(app.includes('memberApi(\'session\')')&&app.includes('memberToken,...fields'));
   assert.ok(read('supabase/functions/bike-services/index.ts').includes('memberSessionAuthorized(member.id,p.memberToken)'));
   assert.ok(read('supabase/functions/member-accounts/index.ts').includes('voltes_member_login_gate'));
 });
 console.log(checks+' frontend regression checks passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
