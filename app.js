'use strict';
// Shared state and admin authorization are provided by the Supabase API.
const {formatMovingTime,validateCompletion}=globalThis.VoltesCompletion;
const API_URL = (window.VOLTES_API_URL || '').trim();
const safe=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
let db={rides:[],riders:[],members:0,routeTemplates:[],publicMembers:[]};
let completionV2=false;
const readLocal=(key,fallback='')=>{try{return localStorage.getItem(key)||fallback}catch{return fallback}};
const writeLocal=(key,value)=>{try{value?localStorage.setItem(key,value):localStorage.removeItem(key);return true}catch{return false}};
let admin=false,pin='',adminToken=readLocal('voltesAdminToken'),route='home',message='',historyLimit=5;
let trashItems=[],trashLoading=false,trashError='';
let backupDraft=null,backupFilename='',backupBusy=false;
let keepaliveInfo={lastPressedAt:null,loaded:false,error:'',clockOffset:0};
let keepaliveBusy=false;
const KEEPALIVE_WINDOW_MS=5*24*60*60*1000;
const keepaliveApiUrl=API_URL.replace(/\/rapid-responder\/?(?:\?.*)?$/,'/voltes-keepalive');

async function keepaliveApi(action){
 if(!admin||!adminToken)throw Error('Απαιτείται σύνδεση Admin.');
 if(!keepaliveApiUrl||keepaliveApiUrl===API_URL)throw Error('Η υπηρεσία Keep Alive δεν έχει ρυθμιστεί.');
 const response=await fetch(keepaliveApiUrl,{
  method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',
  body:JSON.stringify({action,adminToken})
 });
 const data=await response.json();
 if(!response.ok||!data?.ok)throw Error(data?.error||'Αδυναμία επικοινωνίας με το Keep Alive.');
 return data;
}
function updateKeepaliveInfo(data){
 keepaliveInfo={lastPressedAt:data.lastPressedAt||null,loaded:true,error:'',
  clockOffset:Number.isFinite(Date.parse(data.serverNow))?Date.parse(data.serverNow)-Date.now():0};
}
async function loadKeepaliveInfo(){
 if(!admin)return;
 try{updateKeepaliveInfo(await keepaliveApi('state'))}
 catch(e){keepaliveInfo={...keepaliveInfo,loaded:true,error:e?.message||'Ο έλεγχος απέτυχε.'}}
 if(route==='settings'&&admin)render();
}
function keepaliveTimingText(){
 if(keepaliveInfo.error)return '⚠️ '+keepaliveInfo.error;
 if(!keepaliveInfo.loaded)return 'Έλεγχος τελευταίας χρήσης...';
 if(!keepaliveInfo.lastPressedAt)return 'Δεν έχει πατηθεί ακόμη. Η αντίστροφη μέτρηση ξεκινά με τον πρώτο έλεγχο.';
 const start=new Date(keepaliveInfo.lastPressedAt).getTime();
 if(!Number.isFinite(start))return 'Μη έγκυρη ημερομηνία τελευταίου ελέγχου.';
 const elapsed=Math.max(0,Date.now()+keepaliveInfo.clockOffset-start);
 const passedDays=Math.floor(elapsed/86400000),passedHours=Math.floor((elapsed%86400000)/3600000);
 const remaining=Math.max(0,KEEPALIVE_WINDOW_MS-elapsed);
 const totalHoursLeft=Math.ceil(remaining/3600000);
 const leftDays=Math.floor(totalHoursLeft/24);
 const leftHours=totalHoursLeft%24;
 const since='Πέρασαν '+passedDays+' ημ. και '+passedHours+' ώρ.';
 if(remaining<=0)return '⚠️ '+since+' · Το όριο των 5 ημερών έφτασε. Πάτησε Keep Alive.';
 if(elapsed>=4*86400000)return '⏳ '+since+' · Τελευταία ημέρα! Απομένουν '+leftDays+' ημ. και '+leftHours+' ώρ.';
 return '✅ '+since+' · Απομένουν '+leftDays+' ημ. και '+leftHours+' ώρ. έως τις 5 ημέρες.';
}
function keepaliveCard(){
 const last=keepaliveInfo.lastPressedAt;
 const time=last&&Number.isFinite(Date.parse(last))?new Date(last).toLocaleString('el-GR',{timeZone:'Europe/Athens',dateStyle:'short',timeStyle:'short'}):'—';
 const subscribed=window.VoltesPush?.keepaliveAlertsActive?.()===true;
 return `<section class="keepalive-monitor" aria-label="Χειροκίνητος έλεγχος βάσης">
  <h3>Keep Alive βάσης Supabase</h3>
  <p class="note">Τελευταίο χειροκίνητο πάτημα: <b id="keepaliveLastPressed">${safe(time)}</b></p>
  <p class="keepalive-countdown" id="keepaliveCountdown" role="status" aria-live="polite">${safe(keepaliveTimingText())}</p>
  <button class="btn secondary" type="button" data-do="checkDatabase" ${keepaliveBusy?'disabled':''}>↻ Keep Alive τώρα</button>
  <button class="btn secondary" type="button" data-do="toggleKeepaliveAlerts">${subscribed?'🔔 Απενεργοποίηση υπενθύμισης':'🔔 Ενεργοποίηση push Keep Alive'}</button>
  <p class="note">Μία υπενθύμιση push στην 4η ημέρα, μόνο σε συσκευές Admin που την έχουν ενεργοποιήσει. Ο αυτόματος ημερήσιος keep-alive συνεχίζεται ανεξάρτητα· το 5ήμερο μετρά μόνο τα πατήματα αυτού του κουμπιού.</p>
 </section>`;
}
if(typeof window.setInterval==='function')window.setInterval(()=>{
 if(route==='settings'&&admin){
  const target=document.getElementById('keepaliveCountdown');
  if(target)target.textContent=keepaliveTimingText();
 }
},60000);
const themes={blue:'Μπλε',green:'Πράσινο',white:'Λευκό',black:'Μαύρο'};
let chosenTheme=readLocal('voltesTheme','blue');
function setTheme(v){chosenTheme=Object.hasOwn(themes,v)?v:'blue';document.documentElement.dataset.theme=chosenTheme;writeLocal('voltesTheme',chosenTheme)}
setTheme(chosenTheme);

/* Shared bicycle service journal: deliberately lightweight, member name is not authentication. */
const bikeServiceStorageKey='voltesBikeServiceV1'; // Legacy device-only entries are never deleted.
function bikeServiceEntries(){try{const a=JSON.parse(localStorage.getItem(bikeServiceStorageKey)||'[]');return Array.isArray(a)?a:[]}catch{return []}}
function legacyBikeNames(){try{const v=JSON.parse(localStorage.getItem('voltesSavedBikesV2')||'[]');return [...new Set([...(Array.isArray(v)?v:[]),...bikeServiceEntries().map(x=>x.bike)].filter(n=>typeof n==='string'&&n.trim().length>=2&&n.trim().length<=90))]}catch{return [...new Set(bikeServiceEntries().map(x=>x.bike).filter(Boolean))]}}
let bikeCloud={bikes:[],services:[],maintenance:[],memberKm:0,loaded:false,member:''};
const bikeApiUrl=API_URL.replace(/\/rapid-responder\/?(?:\?.*)?$/,'/bike-services');
async function bikeApi(action,fields={}){
 if(!bikeApiUrl||bikeApiUrl===API_URL)throw Error('Δεν έχει ρυθμιστεί η υπηρεσία σέρβις.');
 const response=await fetch(bikeApiUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,memberToken,...fields})});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Σφάλμα επικοινωνίας');return data;
}
let bikeLastFetch=0;
async function loadBikeCloud(){const name=memberName();const data=await bikeApi('state',{memberName:name});if(name!==memberName())return;bikeCloud={bikes:data.bikes||[],services:data.services||[],maintenance:data.maintenance||[],memberKm:Number(data.memberKm||0),loaded:true,member:name};bikeLastFetch=Date.now();if(route==='bikeService'||route==='bikeHistory'||route==='bikeMaintenance'||route==='bikeDetails'||route==='settings')render()}

/* One-time automatic migration per device; Supabase remains the source of truth. */
const bikeLegacyLedgerKey='voltesBikeLegacySyncV1';
let bikeSyncPromise=null;
async function syncLegacyBikes(){
 const names=legacyBikeNames(),entries=bikeServiceEntries();
 if(!memberAccount||!memberToken||!memberName()||(!names.length&&!entries.length))return;
 let ledger={owner:'',bikes:[],services:[]};
 try{
  const value=JSON.parse(readLocal(bikeLegacyLedgerKey,'{}'));
  if(value&&typeof value==='object')ledger={owner:String(value.owner||''),bikes:Array.isArray(value.bikes)?value.bikes:[],services:Array.isArray(value.services)?value.services:[]};
 }catch{}
 const owner=ledger.owner||memberName();
 if(owner!==memberName())return;
 const save=()=>writeLocal(bikeLegacyLedgerKey,JSON.stringify(ledger));
 if(!ledger.owner){ledger.owner=owner;save()}
 const signature=entry=>JSON.stringify([entry.id||'',entry.bike||'',entry.date||'',entry.work||'',entry.km??'',entry.notes||'']);
 let changes=false;
 for(const name of names){
  const clean=name.trim(),key=clean.toLocaleLowerCase('el-GR');
  if(ledger.bikes.includes(key))continue;
  let bike=bikeCloud.bikes.find(b=>b.member_name===owner&&b.name.toLocaleLowerCase('el-GR')===key);
  if(!bike){
   const result=await bikeApi('createBike',{memberName:owner,name:clean});
   bike={id:result.bike.id,name:result.bike.name,member_name:owner};
   bikeCloud.bikes.push(bike);changes=true;
  }
  ledger.bikes.push(key);save();
 }
 for(const entry of entries){
  const key=signature(entry);
  if(ledger.services.includes(key))continue;
  const bike=bikeCloud.bikes.find(b=>b.member_name===owner&&b.name.toLocaleLowerCase('el-GR')===String(entry.bike||'').trim().toLocaleLowerCase('el-GR'));
  if(!bike||!entry.date||!entry.work)continue;
  const km=entry.km===''||entry.km==null?null:Number(entry.km),notes=String(entry.notes||'');
  const result=await bikeApi('importService',{memberName:owner,bikeId:bike.id,date:entry.date,work:entry.work,km,notes});
  if(result.imported)changes=true;
  ledger.services.push(key);save();
 }
 if(changes)await loadBikeCloud();
}
function autoSyncBikeCloud(){
 if(bikeSyncPromise)return bikeSyncPromise;
 if(bikeCloud.loaded&&bikeCloud.member===memberName()&&Date.now()-bikeLastFetch<60000)return Promise.resolve();
 bikeSyncPromise=(async()=>{await loadBikeCloud();await syncLegacyBikes()})().finally(()=>{bikeSyncPromise=null});
 return bikeSyncPromise;
}
async function bikeAction(action,fields,success){
 if(!memberAccount||!memberToken){navigate('memberLogin');toast('Συνδέσου πρώτα στο προσωπικό σου προφίλ.');return false}
 try{await bikeApi(action,{memberName:memberName(),...fields});await loadBikeCloud();if(success)toast(success);return true}
 catch(e){toast(e.message);return false}
}
function ownBikes(){return bikeCloud.bikes.filter(b=>b.member_name===memberName())}
function registeredBikes(){return ownBikes().map(b=>b.name)}
function bikeByName(name){return ownBikes().find(b=>b.name===name)}
function defaultBike(){return ownBikes().find(b=>b.is_default)?.name||registeredBikes()[0]||''}
let bikeWizard={step:1,bike:'',newBike:false,date:'',work:'',km:'',notes:'',editId:''};
const serviceWorks=['Γενικό σέρβις','Αλυσίδα','Φρένα','Λάστιχα','Μετάδοση / ταχύτητες','Άλλη εργασία'];
function resetBikeWizard(){bikeWizard={step:1,bike:defaultBike(),newBike:!registeredBikes().length,date:greekDay(),work:'',km:'',notes:'',editId:''}}
function bikeWizardSelection(label,field,value,selected){
 return '<button type="button" class="quick-option'+(selected?' selected':'')+'" data-do="bikeWizardPick" data-field="'+field+'" data-value="'+safe(value)+'" aria-pressed="'+(selected?'true':'false')+'">'+safe(label)+(selected?' ✓':'')+'</button>';
}
function serviceWizardCompleted(step,title,detail){
 return '<div class="quick-completed"><span class="quick-completed-label"><b>'+step+'. '+safe(title)+'</b><span>'+safe(detail)+'</span></span><button type="button" class="btn secondary quick-change" data-do="bikeWizardEdit" data-step="'+step+'">Αλλαγή</button></div>';
}
function bikeServicePage(view='new'){
 const name=memberName(),q=bikeWizard,bikes=registeredBikes(),shownBikes=ownBikes();
 const items=bikeCloud.services.filter(s=>shownBikes.some(b=>b.id===s.bike_id)).sort((a,b)=>b.service_date.localeCompare(a.service_date));
 let blocks='';
 if(!name)blocks='<div class="card"><p>Για να προσθέσεις ποδήλατο ή σέρβις, συνδέσου πρώτα στο προσωπικό σου προφίλ από τα Μέλη.</p><button class="btn secondary" data-go="members">Επιλογή μέλους</button></div>';
 else if(!bikeCloud.loaded)blocks='<div class="card"><p>Φόρτωση των σέρβις…</p></div>';
 else if(view==='new'){
 if(q.step>1&&q.bike)blocks+=serviceWizardCompleted(1,'Ποδήλατο',q.bike);
 if(q.step>2&&q.date)blocks+=serviceWizardCompleted(2,'Ημερομηνία',datefmt(q.date));
 if(q.step>3&&q.work)blocks+=serviceWizardCompleted(3,'Εργασία',q.work);
 if(q.step===1){
  blocks+='<section class="card quick-step"><h2>1. Ποιο ποδήλατο;</h2>'+
   (bikes.length?'<div class="quick-route-list">'+bikes.map(b=>bikeWizardSelection(b+(b===defaultBike()?' ★':''),'bike',b,q.bike===b&&!q.newBike)).join('')+'</div>':'')+
   '<button type="button" class="btn secondary bike-new-action" data-do="bikeWizardNew">+ Προσθήκη ποδηλάτου</button>'+
   (q.newBike?'<label>Όνομα ποδηλάτου<input id="bikeWizardNewName" maxlength="90" placeholder="π.χ. Cube Agree C62 Pro" autocomplete="off"></label><button type="button" class="btn" data-do="bikeWizardSaveBike">Αποθήκευση ποδηλάτου</button>':'')+
   (q.bike&&!q.newBike?'<button type="button" class="btn bike-wizard-next" data-do="bikeWizardNext">Επόμενο</button>'+(q.bike!==defaultBike()?'<button type="button" class="btn secondary bike-default-action" data-do="bikeWizardDefault">Ορισμός ως προεπιλογή</button>':''):'')+
   '</section>';
 }else if(q.step===2){
  blocks+='<section class="card quick-step"><h2>2. Πότε έγινε το σέρβις;</h2><div class="quick-options">'+
   bikeWizardSelection('Σήμερα','date',greekDay(),q.date===greekDay())+
   bikeWizardSelection('Άλλη ημερομηνία','date','other',q.date!==greekDay())+'</div>'+
   (q.date!==greekDay()?'<label>Ημερομηνία<input type="date" id="bikeWizardDate" max="'+greekDay()+'" value="'+safe(q.date)+'"></label>':'')+
   '<button type="button" class="btn bike-wizard-next" data-do="bikeWizardNext">Επόμενο</button></section>';
 }else if(q.step===3){
  blocks+='<section class="card quick-step"><h2>3. Τι σέρβις έγινε;</h2><div class="quick-route-list">'+
   serviceWorks.map(work=>bikeWizardSelection(work,'work',work,q.work===work)).join('')+'</div></section>';
 }else if(q.step===4){
  blocks+='<section class="card quick-step"><h2>4. Προαιρετικά στοιχεία</h2>'+
   '<form id="bikeServiceForm"><label>Χιλιόμετρα ποδηλάτου<input type="number" name="km" min="0" max="1000000" step="1" value="'+safe(q.km)+'" placeholder="π.χ. 4500"></label>'+
   '<label>Παρατηρήσεις<textarea name="notes" rows="3" maxlength="600" placeholder="Τι έγινε στο σέρβις;">'+safe(q.notes)+'</textarea></label>'+
   '<button class="btn" type="submit">'+(q.editId?'Αποθήκευση αλλαγών':'Αποθήκευση σέρβις')+'</button></form></section>';
 }
 }
 if(view==='new'){
  return '<h1>🔧 Νέο σέρβις</h1>'+blocks+
   '<div class="actions"><button type="button" class="btn secondary" data-go="members">Επιστροφή στο προφίλ</button></div>';
 }
 const history='<div class="bike-service-history">'+(items.length?items.map(item=>{
  const bike=bikeCloud.bikes.find(b=>b.id===item.bike_id),own=!!name&&bike?.member_name===name;
  return '<article class="card bike-service-entry"><div class="row"><strong>'+safe(bike?.name||'Ποδήλατο')+'</strong></div>'+
  '<p>🔧 '+safe(item.work)+'</p><p class="muted">📅 '+safe(datefmt(item.service_date))+(item.km!==null?' · '+safe(item.km)+' χλμ.':'')+'</p>'+
  (item.notes?'<p class="note">'+safe(item.notes)+'</p>':'')+
  (own?'<div class="actions"><button type="button" class="btn secondary" data-do="editBikeService" data-id="'+safe(item.id)+'">Διόρθωση</button><button type="button" class="btn danger" data-do="deleteBikeService" data-id="'+safe(item.id)+'">Διαγραφή</button></div>':'')+'</article>'
 }).join(''):'<p class="empty">Δεν υπάρχουν καταχωρισμένα σέρβις.</p>')+'</div>';
 return '<h1>🔧 Παλιά σέρβις</h1>'+
 (name&&!bikeCloud.loaded?blocks:'')+
 (name&&bikeCloud.loaded?'<div class="card"><h2>Ιστορικό συντήρησης</h2>'+history+'</div>':!name?blocks:'')+
 '<div class="actions"><button type="button" class="btn secondary" data-go="members">Επιστροφή στο προφίλ</button></div>';
}


/* Shared bicycle details: tap an existing tile to edit in place. */
const bikeDetailFields=[
 ['frame','Πλαίσιο / σκελετός'],['fork','Πιρούνι'],['wheelset','Τροχοί / ζάντες'],
 ['tires','Ελαστικά'],['valves','Βαλβίδες'],['sealant','Υγρό tubeless'],
 ['groupset','Σύστημα ταχυτήτων'],['crankset','Δισκοβραχίονας'],['cassette','Κασέτα'],
 ['chain','Αλυσίδα'],['brakes','Φρένα'],['rotors','Δισκόπλακες'],
 ['handlebar','Τιμόνι / λαιμός'],['saddle','Σέλα'],['seatpost','Παλουκόσελο'],
 ['pedals','Πετάλια'],['other','Άλλα εξαρτήματα']
];
let bikeDetailsEditId='',bikeDetailsFieldKey='';
function bikeDetailsPage(){
 const name=memberName();
 if(!name)return '<h1>🚴 Πληροφορίες ποδηλάτου</h1><div class="card"><p>Συνδέσου πρώτα στο προσωπικό σου προφίλ.</p><button class="btn secondary" data-go="members">Επιλογή μέλους</button></div>';
 if(!bikeCloud.loaded)return '<h1>🚴 Πληροφορίες ποδηλάτου</h1><div class="card"><p>Φόρτωση…</p></div>';
 const output=ownBikes().map(bike=>{
  const info=bike.bike_details&&typeof bike.bike_details==='object'&&!Array.isArray(bike.bike_details)?bike.bike_details:{};
  const editing=bikeDetailsEditId===bike.id;
  const isActive=key=>editing&&bikeDetailsFieldKey===key;
  const bar=key=>typeof info[key]==='number'&&Number.isFinite(info[key])?info[key].toLocaleString('el-GR',{maximumFractionDigits:1})+' bar':'—';
  const psi=key=>typeof info[key]==='number'&&Number.isFinite(info[key])?Math.round(info[key]*14.5038)+' PSI':'—';
  const editForm=(key,label)=>{
   const pressure=key==='frontBar'||key==='rearBar';
   return '<form id="bikeDetailsFieldForm" class="bike-inline-form" data-bike-id="'+safe(bike.id)+'" data-field="'+safe(key)+'">'+
    '<label for="bikeDetailsValue">'+safe(label)+'</label>'+
    '<div class="bike-inline-controls">'+
    '<input id="bikeDetailsValue" name="value" '+(pressure?'type="number" min="0.5" max="10" step="0.1" inputmode="decimal"':'type="text" maxlength="160"')+
    ' value="'+safe(info[key]??'')+'" autocomplete="off" aria-label="'+safe(label)+'">'+
    '<button class="btn" type="submit" aria-label="Αποθήκευση">✓</button>'+
    '<button class="btn secondary" type="button" data-do="cancelBikeDetailsField" aria-label="Ακύρωση">✕</button></div></form>';
  };
  const pressureTile=(key,label)=>{
   if(isActive(key))return '<div class="bike-pressure-item is-editing">'+editForm(key,label)+'</div>';
   const inner='<span>'+safe(label)+'</span><strong>'+bar(key)+'</strong><small>'+psi(key)+'</small>'+(editing?'<span class="bike-edit-icon" aria-hidden="true">✎</span>':'');
   return editing?
    '<button type="button" class="bike-pressure-item bike-edit-target" data-do="pickBikeDetailsField" data-bike-id="'+safe(bike.id)+'" data-field="'+key+'">'+inner+'</button>':
    '<div class="bike-pressure-item">'+inner+'</div>';
  };
  const rows=bikeDetailFields.filter(([key])=>typeof info[key]==='string'&&info[key].trim()).map(([key,label])=>{
   if(isActive(key))return '<div class="bike-part-inline">'+editForm(key,label)+'</div>';
   const inside='<span>'+safe(label)+'</span><strong>'+safe(info[key])+'</strong>'+(editing?'<span class="bike-edit-icon" aria-hidden="true">✎</span>':'');
   return editing?
    '<button type="button" class="bike-part-row bike-edit-target" data-do="pickBikeDetailsField" data-bike-id="'+safe(bike.id)+'" data-field="'+key+'">'+inside+'</button>':
    '<div class="bike-part-row">'+inside+'</div>';
  }).join('');
  const missing=bikeDetailFields.filter(([key])=>!info[key]||typeof info[key]!=='string'||!info[key].trim());
  const add=editing&&missing.length?'<label class="bike-add-field"><span class="sr-only">Προσθήκη εξαρτήματος</span>'+
   '<select id="bikeDetailsAddSelect" data-bike-id="'+safe(bike.id)+'" aria-label="Προσθήκη εξαρτήματος">'+
   '<option value="">+ Εξάρτημα</option>'+
   missing.map(([key,label])=>'<option value="'+key+'">'+safe(label)+'</option>').join('')+
   '</select></label>':'';
  return '<section class="card bike-details-card">'+
   '<div class="bike-details-head"><h2>'+safe(bike.name)+'</h2>'+
   '<button type="button" class="btn secondary" data-do="editBikeDetails" data-bike-id="'+safe(bike.id)+'">'+
   (editing?'✓ Τέλος':'✎ Επεξεργασία')+'</button></div>'+
   '<h3>Πίεση ελαστικών</h3><div class="bike-pressure-grid">'+pressureTile('frontBar','Μπροστά')+pressureTile('rearBar','Πίσω')+'</div>'+
   '<h3>Εξαρτήματα</h3><div class="bike-parts-list">'+(rows||'<p class="muted">Δεν υπάρχουν εξαρτήματα.</p>')+'</div>'+add+
   '</section>';
 }).join('');
 return '<h1>🚴 Πληροφορίες ποδηλάτου</h1>'+
   (output||'<div class="card">Δεν υπάρχει ποδήλατο. Πρόσθεσέ το από το Νέο σέρβις.</div>')+
   '<div class="actions"><button type="button" class="btn secondary" data-go="members">Επιστροφή στο προφίλ</button></div>';
}

let maintenanceEditId='';
function maintenanceForm(item,bike){
 const newItem=!item;
 return '<form class="card" id="bikeMaintenanceForm" data-bike-id="'+safe(bike.id)+'" data-id="'+safe(item?.id||'')+'">'+
  '<h2>'+(newItem?'Νέα προγραμματισμένη εργασία':'Ρύθμιση εργασίας')+'</h2>'+
  '<label>Εργασία<input name="label" required maxlength="100" value="'+safe(item?.label||'')+'" placeholder="π.χ. Έλεγχος ελαστικών"></label>'+
  '<label>Κάθε πόσα χιλιόμετρα;<input type="number" name="intervalKm" min="1" max="100000" step="1" value="'+safe(item?.interval_km??'')+'" placeholder="Προαιρετικό"></label>'+
  '<label>Κάθε πόσες ημέρες;<input type="number" name="intervalDays" min="1" max="3650" step="1" value="'+safe(item?.interval_days??'')+'" placeholder="Προαιρετικό"></label>'+
  '<label>Χλμ. τελευταίας εργασίας<input type="number" name="lastKm" min="0" max="1000000" step="0.01" value="'+safe(item?.last_km??'')+'" placeholder="Αν είναι γνωστά"></label>'+
  '<label>Ημερομηνία τελευταίας εργασίας<input type="date" name="lastDate" max="'+greekDay()+'" value="'+safe(item?.last_date||'')+'"></label>'+
  '<label>Σημειώσεις<textarea name="notes" maxlength="400" rows="2">'+safe(item?.notes||'')+'</textarea></label>'+
  '<div class="actions"><button class="btn" type="submit">Αποθήκευση</button><button class="btn secondary" type="button" data-do="cancelMaintenanceEdit">Άκυρο</button></div>'+
  '</form>';
}
function maintenanceCard(task,bike){
 const current=bike.odometer_km==null?null:Number(bike.odometer_km);
 const spent=task.last_km==null||current==null?null:Math.max(0,current-Number(task.last_km));
 const remainingKm=task.interval_km!=null&&spent!=null?Math.ceil(Number(task.interval_km)-spent):null;
 const elapsed=task.last_date?Math.max(0,Math.floor((Date.parse(greekDay()+'T12:00:00Z')-Date.parse(task.last_date+'T12:00:00Z'))/86400000)):null;
 const remainingDays=task.interval_days!=null&&elapsed!=null?Number(task.interval_days)-elapsed:null;
 const late=(remainingKm!==null&&remainingKm<=0)||(remainingDays!==null&&remainingDays<=0);
 const kmLine=task.interval_km==null?'':(spent===null?'<p class="muted">Χιλιόμετρα: δεν έχει καταγραφεί η προηγούμενη εργασία.</p>':
  '<p><strong>'+Math.floor(spent)+'/'+task.interval_km+' χλμ.</strong> · '+(remainingKm>0?'Απομένουν '+remainingKm+' χλμ.':'Έφτασε το όριο χιλιομέτρων')+'</p>'+
  '<progress max="'+task.interval_km+'" value="'+Math.min(Number(task.interval_km),spent)+'" style="width:100%;height:12px;accent-color:#24a968" aria-label="Πρόοδος χιλιομέτρων"></progress>');
 const daysLine=task.interval_days==null?'':(remainingDays===null?'<p class="muted">Δεν έχει καταγραφεί η προηγούμενη ημερομηνία.</p>':
  '<p><strong>'+(remainingDays>0?'Απομένουν '+remainingDays+' ημέρες':'Έφτασε η ημερομηνία ελέγχου')+'</strong> · '+safe(datefmt(new Date(Date.parse(task.last_date+'T12:00:00Z')+Number(task.interval_days)*86400000).toISOString().slice(0,10)))+'</p>');
 return '<article class="card bike-service-entry"><div class="row"><strong>'+safe(task.label)+'</strong>'+(late?'<strong style="color:#e89f39">Έλεγχος τώρα</strong>':'')+'</div>'+
  kmLine+daysLine+(task.notes?'<p class="muted">'+safe(task.notes)+'</p>':'')+
  '<div class="actions"><button type="button" class="btn" data-do="completeMaintenance" data-id="'+safe(task.id)+'" data-bike-id="'+safe(bike.id)+'">Έγινε · Μηδενισμός</button>'+
  '<button type="button" class="btn secondary" data-do="editMaintenance" data-id="'+safe(task.id)+'">Ρύθμιση</button>'+
  '<button type="button" class="btn danger" data-do="deleteMaintenance" data-id="'+safe(task.id)+'" data-bike-id="'+safe(bike.id)+'">Διαγραφή</button></div></article>';
}
function bikeMaintenancePage(){
 if(!memberName())return '<h1>🔧 Προγραμματισμένοι έλεγχοι</h1><div class="card">Συνδέσου πρώτα στο προσωπικό σου προφίλ.</div>';
 if(!bikeCloud.loaded)return '<h1>🔧 Προγραμματισμένοι έλεγχοι</h1><div class="card">Φόρτωση προγράμματος…</div>';
 const bikes=ownBikes();
 const cards=bikes.map(bike=>{
  const tasks=bikeCloud.maintenance.filter(t=>t.bike_id===bike.id);
  const groupKm=Number(bikeCloud.memberKm||0).toLocaleString('el-GR',{maximumFractionDigits:2});
  const realKm=bike.odometer_km==null?'Δεν έχει οριστεί':Number(bike.odometer_km).toLocaleString('el-GR',{maximumFractionDigits:2})+' χλμ.';
  const rename=bike.name==='Το ποδήλατό μου'?'<form id="bikeRenameForm"><label>Όνομα ποδηλάτου<input name="name" maxlength="90" required minlength="2" placeholder="π.χ. Cube Agree C:62 Pro"></label><button class="btn secondary" type="submit">Αποθήκευση ονόματος</button></form>':'';
  const head='<div class="card"><h2>'+safe(bike.name)+'</h2><p><strong>Χιλιόμετρα ποδηλάτου: '+realKm+'</strong></p>'+
   '<p class="muted">Χιλιόμετρα από καταγεγραμμένες βόλτες ομάδας: '+safe(groupKm)+' χλμ.</p>'+
   '<p class="muted">'+(bike.auto_tracking?'Κάθε ολοκληρωμένη βόλτα στην οποία συμμετέχεις προσθέτει τα χιλιόμετρά της αυτόματα.':'Έχεις περισσότερα ποδήλατα: τα χιλιόμετρα μέλους μετρώνται, αλλά η κατανομή ανά ποδήλατο γίνεται χειροκίνητα.')+'</p>'+
   (bike.name==='Το ποδήλατό μου'?'<p class="muted">Προσωρινό όνομα: γράψε το πραγματικό μοντέλο σου. Οι αρχικοί μετρητές ξεκινούν από τα χιλιόμετρα της εφαρμογής, όχι από επιβεβαιωμένη προηγούμενη συντήρηση.</p>':'')+
   rename+
   '<form id="bikeOdometerForm" data-bike-id="'+safe(bike.id)+'"><label>Διόρθωση ένδειξης χιλιομέτρων<input type="number" name="km" required min="0" max="1000000" step="0.01" value="'+safe(bike.odometer_km??'')+'"></label><button class="btn secondary" type="submit">Αποθήκευση ένδειξης</button></form></div>';
  const entries=tasks.map(t=>maintenanceEditId===t.id?maintenanceForm(t,bike):maintenanceCard(t,bike)).join('');
  const adding=maintenanceEditId==='new:'+bike.id?maintenanceForm(null,bike):'<div class="actions"><button type="button" class="btn secondary" data-do="newMaintenance" data-bike-id="'+safe(bike.id)+'">+ Νέα εργασία</button></div>';
  return head+(entries||'<div class="card">Δεν υπάρχουν προγραμματισμένοι έλεγχοι.</div>')+adding;
 }).join('');
 return '<h1>🔧 Προγραμματισμένοι έλεγχοι</h1>'+cards+
 '<div class="actions"><button class="btn secondary" type="button" data-go="bikeHistory">Ιστορικό σέρβις</button><button class="btn secondary" type="button" data-go="members">Επιστροφή στο προφίλ</button></div>';
}


/* The recoverable bin is visible ONLY after server-confirmed Admin login. */
async function loadTrash(){
 if(!admin)return;
 trashLoading=true;trashError='';
 if(route==='trash')render();
 try{
  const result=await api('trashList');
  if(!admin)return;
  trashItems=Array.isArray(result.items)?result.items:[];
 }catch(e){trashError=e?.message||'Αδύνατη η φόρτωση κάδου.'}
 finally{trashLoading=false;if(route==='trash')render()}
}
function trashPage(){
 if(!admin)return '<p class="alert">Η πρόσβαση επιτρέπεται μόνο στον Admin.</p>';
 const labels={ride:'Βόλτα',rider:'Μέλος',maintenance:'Εργασία συντήρησης',service:'Σέρβις',route:'Διαδρομή'};
 const cards=trashItems.map(item=>{
  const title=safe(item.label||'Χωρίς τίτλο'),kind=safe(labels[item.kind]||'Καταχώριση');
  const dt=new Date(item.deleted_at);
  const when=Number.isFinite(dt.getTime())?safe(dt.toLocaleString('el-GR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})):'—';
  return '<article class="card trash-entry"><div class="trash-entry-head"><div><span class="trash-type">'+kind+'</span><h3>'+title+'</h3><p class="muted">Διαγράφηκε: '+when+'</p></div><button class="btn secondary" type="button" data-do="restoreTrash" data-id="'+safe(item.id)+'">↩ Επαναφορά</button></div></article>';
 }).join('');
 return '<h1>🗑️ Κάδος διαγραμμένων</h1>'+
  '<div class="card trash-info"><p>Τα διαγραμμένα στοιχεία διατηρούνται για <strong>30 ημέρες</strong>. Η επαναφορά δεν αλλάζει τις υπόλοιπες καταχωρίσεις και δεν στέλνει Push.</p></div>'+
  (trashLoading?'<div class="card">Φόρτωση κάδου…</div>':
  trashError?'<div class="card"><p class="alert">'+safe(trashError)+'</p><button class="btn secondary" type="button" data-do="refreshTrash">Ξανά δοκιμή</button></div>':
  cards||'<div class="card"><p class="empty">Ο κάδος είναι άδειος.</p></div>')+
  '<div class="actions"><button class="btn secondary" type="button" data-go="settings">← Επιστροφή στο Admin</button></div>';
}


const BACKUP_DATASETS=['voltes_route_templates','voltes_riders','voltes_rides','voltes_signups',
 'voltes_ride_admin_notes','voltes_bikes','voltes_bike_services','voltes_bike_maintenance','voltes_trash'];
function inspectBackup(value){
 if(!value||typeof value!=='object'||Array.isArray(value)
    ||value.format!=='voltes-manual-backup'||value.version!==1||value.scope!=='group-data'
    ||!value.tables||typeof value.tables!=='object'||Array.isArray(value.tables))
   throw Error('Αυτό το αρχείο δεν είναι έγκυρο backup της Ποδηλασίας.');
 const names=Object.keys(value.tables);
 if(names.length!==BACKUP_DATASETS.length || names.some(x=>!BACKUP_DATASETS.includes(x)))
   throw Error('Το αρχείο δεν έχει τις αναμενόμενες ενότητες.');
 let count=0;
 for(const key of BACKUP_DATASETS){
  const rows=value.tables[key];
  if(!Array.isArray(rows)||rows.length>5000||
     rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)||
       typeof r[key==='voltes_ride_admin_notes'?'ride_id':'id']!=='string'))
   throw Error('Μη έγκυρα δεδομένα στην ενότητα '+key);
  count+=rows.length;
 }
 return {count,rides:value.tables.voltes_rides.length,members:value.tables.voltes_riders.length,bikes:value.tables.voltes_bikes.length};
}
function backupPage(){
 if(!admin)return '<p class="alert">Η πρόσβαση επιτρέπεται μόνο στον Admin.</p>';
 const preview=backupDraft?inspectBackup(backupDraft):null;
 const timestamp=backupDraft?.created_at?new Date(backupDraft.created_at):null;
 const when=timestamp&&Number.isFinite(timestamp.getTime())?
  timestamp.toLocaleString('el-GR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
 return '<h1>💾 Επαναφορά Backup</h1>'+
  '<div class="card backup-card"><h2>Επιλογή αρχείου</h2>'+
  '<p class="muted">Επίλεξε ένα αρχείο JSON που έχεις κατεβάσει από την Ποδηλασία.</p>'+
  '<label class="backup-file-label" for="voltesBackupFile">Αρχείο backup</label>'+
  '<input id="voltesBackupFile" type="file" accept=".json,application/json"'+(backupBusy?' disabled':'')+'>'+
  (preview?'<div class="backup-preview"><strong>✓ '+safe(backupFilename)+'</strong>'+
    '<p>Αντίγραφο: '+safe(when)+'</p>'+
    '<div class="backup-counts"><span>Βόλτες <b>'+preview.rides+'</b></span><span>Μέλη <b>'+preview.members+
    '</b></span><span>Ποδήλατα <b>'+preview.bikes+'</b></span><span>Σύνολο εγγραφών <b>'+preview.count+'</b></span></div>'+
    '</div>':'')+
  '<p class="backup-warning">Η επαναφορά <strong>προσθέτει μόνο όσα λείπουν</strong>. Δεν διαγράφει ή αντικαθιστά υπάρχοντα δεδομένα και δεν στέλνει Push.</p>'+
  '<div class="actions">'+(preview?
    '<button type="button" class="btn" data-do="restoreFileBackup"'+(backupBusy?' disabled':'')+'>↩ Επαναφορά από αρχείο</button>':'')+
  '<button type="button" class="btn secondary" data-go="settings">← Πίσω στο Admin</button></div></div>';
}
async function downloadFileBackup(button){
 if(!admin)return;
 button.disabled=true;
 try{
  const response=await api('backupExport');
  const backup=response.backup;
  inspectBackup(backup);
  const json=JSON.stringify(backup);
  const blob=new Blob([json],{type:'application/json;charset=utf-8'});
  if(blob.size>5000000)throw Error('Το αντίγραφο υπερβαίνει τα 5 MB.');
  const url=URL.createObjectURL(blob);
  try{
   const link=document.createElement('a');
   link.href=url;
   const date=new Date();
   const stamp=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')
    +'_'+String(date.getHours()).padStart(2,'0')+'-'+String(date.getMinutes()).padStart(2,'0');
   link.download='voltes-backup-'+stamp+'.json';
   document.body.appendChild(link);
   link.click();link.remove();
  }finally{setTimeout(()=>URL.revokeObjectURL(url),15000)}
  toast('Έγινε λήψη του αρχείου Backup.');
 }catch(e){toast('Αποτυχία Backup: '+(e?.message||'Άγνωστο σφάλμα'))}
 finally{button.disabled=false}
}

function themeSettings(){
 const colors=`<section class="card settings-compact"><h2>🎨 Εμφάνιση</h2><div class="theme-options">${Object.entries(themes).map(([k,v])=>`<button type="button" class="theme-option theme-${k}" data-theme="${k}" aria-pressed="${k===chosenTheme}">${v}${k===chosenTheme?' ✓':''}</button>`).join('')}</div></section>`;
 const notifications=`<section class="card voltes-push-card" aria-labelledby="voltesPushHeading"><div class="voltes-push-heading"><span aria-hidden="true">🔔</span><h2 id="voltesPushHeading">Ειδοποιήσεις βόλτας & καιρού</h2></div><p id="voltesPushState" role="status" class="muted">Push για νέες βόλτες και προειδοποιήσεις βροχής πριν από προγραμματισμένες διαδρομές.</p><div class="voltes-push-actions" role="group" aria-label="Ειδοποιήσεις νέας βόλτας"><button type="button" class="btn" id="voltesPushEnable" aria-pressed="false">Ενεργοποίηση</button><button type="button" class="btn secondary" id="voltesPushDisable" aria-pressed="false">Απενεργοποίηση</button></div></section>`;
 const adminPanel=admin?`
  <div class="settings-admin-primary">
   <button type="button" class="btn" data-go="new">+ Νέα βόλτα</button>
   <button type="button" class="btn secondary" data-go="riders">Ποδηλάτες & επισκέπτες</button>
  </div>
  <details class="settings-more"><summary>Διαδρομές και στατιστικά</summary>
   <div class="admin-settings">
    <button class="btn secondary" data-go="routes">Αποθηκευμένες διαδρομές</button>
    <button class="btn secondary" data-go="routeAdd">+ Προσθήκη διαδρομής</button>
    <button class="btn secondary" data-go="historyAdd">+ Προσθήκη παλιάς βόλτας</button>
    <button class="btn secondary" data-go="stats">Στατιστικά</button>
   </div>
  </details>
  <details class="settings-more"><summary>Ασφάλεια, Backup & έλεγχος βάσης</summary>
   <div class="admin-settings">
    <button class="btn secondary" data-go="trash">🗑️ Κάδος διαγραμμένων</button>
    <button class="btn secondary" data-do="downloadBackup">⬇ Λήψη Backup</button>
    <button class="btn secondary" data-go="backup">↩ Επαναφορά Backup</button>
   </div>
   ${keepaliveCard()}
  </details>
  <button type="button" class="btn secondary settings-admin-logout" data-do="adminLogout">Αποσύνδεση Admin</button>
 `:'<button type="button" class="btn secondary" data-go="auth">Είσοδος Admin</button>';
 const expired=admin&&db.rides.some(expiredRide)?`<section class="card"><h2>Παλιές προγραμματισμένες βόλτες</h2><p class="muted">Αποσύρθηκαν από την Αρχική. Μπορείς να τις ολοκληρώσεις ή να τις διαγράψεις.</p>${db.rides.filter(expiredRide).map(rideCard).join('')}</section>`:'';
 return `<h1>Ρυθμίσεις</h1>${colors}${notifications}<section class="card settings-compact settings-admin-card"><h2>🛡️ Διαχείριση Admin</h2>${adminPanel}</section>${expired}`;
}
/* Password-backed member profiles. The former locally chosen name is never authorization. */
const memberSessionKey='voltesMemberTokenV1';
const accountApiUrl=API_URL.replace(/\/rapid-responder\/?(?:\?.*)?$/,'/member-accounts');
let memberToken=readLocal(memberSessionKey),memberAccount=null;
let memberCredentialIds=null,adminIssuedRecovery=null;
async function loadMemberCredentialStatus(){
 if(!admin)return;
 try{
  const data=await memberApi('adminAccountStates');
  memberCredentialIds=new Set(Array.isArray(data.activeMemberIds)?data.activeMemberIds:[]);
 }catch(err){
  memberCredentialIds=null;
  if(route==='riders')toast('Δεν φορτώθηκε η κατάσταση κωδικών: '+(err?.message||'Σφάλμα'));
  return;
 }
 if(route==='riders')render();
}
function memberName(){return memberAccount?.name||''}
async function memberApi(action,fields={}){
 if(!accountApiUrl||accountApiUrl===API_URL)throw Error('Η υπηρεσία προφίλ δεν είναι διαθέσιμη.');
 const response=await fetch(accountApiUrl,{method:'POST',
  headers:{'Content-Type':'application/json'},cache:'no-store',
  body:JSON.stringify({action,memberToken,adminToken,...fields})});
 const data=await response.json();if(!response.ok||!data?.ok)throw Error(data?.error||'Η ενέργεια απέτυχε.');
 return data;
}
function memberSignedIn(data){
 if(!data?.memberToken||!data?.member?.name)throw Error('Η υπηρεσία σύνδεσης δεν επέστρεψε έγκυρα στοιχεία.');
 memberToken=data.memberToken;memberAccount=data.member;
 writeLocal(memberSessionKey,memberToken);
 writeLocal('voltesLastSignupName',memberAccount.name);
 bikeCloud.loaded=false;bikeLastFetch=0;bikeDetailsEditId='';bikeDetailsFieldKey='';
 resetBikeWizard();
}
async function restoreMemberSession(){
 if(!memberToken)return;
 try{
  const result=await memberApi('session');
  memberAccount=result.member;
  writeLocal('voltesLastSignupName',memberAccount.name);
 }catch{
  memberToken='';memberAccount=null;writeLocal(memberSessionKey,'');
 }
 render();
}
async function memberLogout(){
 try{if(memberToken)await memberApi('logout')}catch{}
 memberToken='';memberAccount=null;writeLocal(memberSessionKey,'');
 bikeCloud={bikes:[],services:[],maintenance:[],memberKm:0,loaded:false,member:''};
 bikeLastFetch=0;resetBikeWizard();navigate('members');
}
let signupTokens;try{signupTokens=JSON.parse(readLocal('voltesSignupTokens','{}'));if(!signupTokens||typeof signupTokens!=='object'||Array.isArray(signupTokens))signupTokens={}}catch{signupTokens={}}
sessionStorage.removeItem('voltesAdminPin');
function newToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}
function saveSignupTokens(){return writeLocal('voltesSignupTokens',JSON.stringify(signupTokens))}
const app=document.querySelector('#app'),nav=document.querySelector('#nav');
async function api(action,fields={}){
 if(!API_URL)throw Error('Χρειάζεται σύνδεση με το Supabase (config.js).');
 const response=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...fields,pin:pin||undefined,adminToken:adminToken||undefined,memberToken:memberToken||undefined,...(action==='state'?{signupTokens}: {})})});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Σφάλμα επικοινωνίας');return data;
}
async function refresh(){const result=await api('state');db={rides:result.rides||[],riders:result.riders||[],members:result.members||0,routeTemplates:result.routeTemplates||[],publicMembers:result.publicMembers||[]};admin=!!result.admin;if(!admin&&adminToken){adminToken='';writeLocal('voltesAdminToken','')}completionV2=result.capabilities?.rideCompletionV2===true;if(!admin){trashItems=[];trashError='';backupDraft=null;backupFilename=''}render()}
async function perform(action,fields,success){try{await api(action,fields);await refresh();return true}catch(e){toast(e.message);return false}}
const embeddedAdminRoute=(()=>{if(window.self===window.top)return "";const k=new URLSearchParams(location.search).get("adminView");return ["new","settings","backup","riders","stats","routes","trash"].includes(k)?k:""})();
async function start(){
 if(!API_URL){app.innerHTML='<p class="alert">Η εφαρμογή χρειάζεται ρύθμιση του Supabase. Συμπλήρωσε το API_URL στο config.js σύμφωνα με το README.</p>';return}
 try{await refresh();if(embeddedAdminRoute)navigate(admin?embeddedAdminRoute:'auth');await restoreMemberSession();await autoSyncBikeCloud()}catch(e){if(route==='bikeHistory'||route==='bikeService'||route==='bikeDetails'||route==='bikeMaintenance')toast(e.message);else if(!db.publicMembers.length)app.innerHTML=`<p class="alert">${safe(e.message)}</p>`}
}
const datefmt=d=>new Date(d+'T12:00:00').toLocaleDateString('el-GR',{day:'2-digit',month:'2-digit',year:'numeric'});
function toast(v){message=v;render()}
function navigate(v){if(v==='bikeDetails'){bikeDetailsEditId='';bikeDetailsFieldKey='';bikeLastFetch=0;autoSyncBikeCloud().catch(e=>toast(e.message))}if(v==='bikeMaintenance'){bikeLastFetch=0;autoSyncBikeCloud().catch(e=>toast(e.message))}if(v==='bikeService'){resetBikeWizard();autoSyncBikeCloud().catch(e=>toast(e.message))}if(v==='bikeHistory'){autoSyncBikeCloud().catch(e=>toast(e.message))}if(v==='new')quickRideState={day:'',date:'',period:'',time:'',showTimePicker:false,routeId:'',placeMode:'mavili',customPlace:'',step:1};route=v;if(v==='history')historyLimit=5;nav.classList.add('hidden');document.querySelector('[data-bottom-route="menu"]')?.setAttribute('aria-expanded','false');render();if(v==='trash'&&admin)loadTrash().catch(e=>toast(e.message));if(v==='riders'&&admin){memberCredentialIds=null;loadMemberCredentialStatus().catch(e=>toast(e.message))}if(v==='settings'&&admin)loadKeepaliveInfo().catch(e=>toast(e.message));if(v==='auth')document.querySelector('#login input[name="pin"]')?.focus({preventScroll:true});document.querySelector(".shell").scrollTo(0,0)}
function renderNotice(){return message?`<p class="alert" role="status">${safe(message)}</p>`:''}
function stats(){let completed=db.rides.filter(x=>x.done);return `<section class="metrics"><div class="metric"><b>${completed.length}</b><small>Βόλτες</small></div><div class="metric"><b>${Math.round(completed.reduce((a,x)=>a+Number(x.km||0),0))}</b><small>Χιλιόμετρα</small></div><div class="metric"><b>${(admin?db.riders.filter(x=>x.member).length:db.members)}</b><small>Μέλη</small></div></section>`}
function expiredRide(r){return !r.done&&Date.now()-new Date(String(r.date)+'T'+String(r.time||'10:00')+':00').getTime()>86400000}
function active(){return db.rides.filter(r=>!r.done&&!expiredRide(r)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))}
function completed(){return db.rides.filter(r=>r.done).sort((a,b)=>(b.date+(b.time||'')).localeCompare(a.date+(a.time||'')))}
function weatherHtml(w){if(!w)return '';const dir=['Β','ΒΑ','Α','ΝΑ','Ν','ΝΔ','Δ','ΒΔ'][Math.round(Number(w.direction||0)/45)%8];const time=new Date(w.updatedAt).toLocaleTimeString('el-GR',{timeZone:'Europe/Athens',hour:'2-digit',minute:'2-digit',hour12:false});const fmt=x=>Number.isFinite(Number(x))?Math.round(Number(x)):'—';const code=Number(w.code);const symbol=code===0?'☀️':code<=3?'⛅':code>=51&&code<=82?'🌧️':code>=95?'⛈️':'☁️';return `<div class="ride-weather"><div class="weather-grid"><div><span>${symbol}</span><b>${fmt(w.temperature)}°C</b><small>${code===0?'Ήλιος':code<=3?'Λίγα νέφη':code>=51?'Βροχή':'Συννεφιά'}</small></div><div><span>🌬️</span><b>${fmt(w.wind)} km/h</b><small>${dir} · Ριπές ${fmt(w.gust)}</small></div><div><span>🌧️</span><b>${fmt(w.rain)}%</b><small>Βροχή</small></div></div><p class="weather-updated">Τελευταία ενημέρωση ${safe(time)}</p></div>`}
function rideCard(r){let n=r.done?(r.attendeeCount??(r.attendees||[]).length):(r.signupCount??(r.signups||[]).length);return `<article class="card ride-card"><div class="ride-heading"><strong class="ride-title">${safe(r.title||'Ποδηλατική βόλτα')}</strong></div><p class="ride-date">📅 ${datefmt(r.date)} · ${safe(rideDeparture(r))}</p>${r.place?`<p class="ride-meeting">📍 Σημείο συνάντησης: ${safe(r.place)}</p>`:''}<div class="ride-metrics"><div class="ride-metric"><span aria-hidden="true">🚴</span><b>${r.done?safe(r.km)+' km':(r.estimate?safe(r.estimate)+' km':'—')}</b><small>${r.done?'Απόσταση':'Εκτίμηση απόστασης'}</small></div><div class="ride-metric"><span aria-hidden="true">👥</span><b>${n}</b><small>${r.done?'Συμμετέχοντες':'Δηλώσεις συμμετοχής'}</small></div></div>${r.done?`<p class="muted">Υψομετρική ανάβαση: ${r.elevationGain==null?'—':safe(r.elevationGain)+' m'} · Χρόνος κίνησης: ${r.movingMinutes==null?'—':safe(formatMovingTime(r.movingMinutes))}</p>`:''}${r.routePoints?.length?`<div class="ride-route"><b>Διαδρομή</b><p>${r.routePoints.map(safe).join(' → ')}</p></div>`:''}${admin&&r.done?`<p>Μέση ταχύτητα: <b>${safe(r.speed)} km/h</b></p><p class="muted">Συμμετείχαν: ${(r.attendees||[]).map(safe).join(', ')||'—'}</p>${r.slowdownNotes?`<p class="note">Ιδιωτική παρατήρηση Admin: ${safe(r.slowdownNotes)}</p>`:''}${r.slowed?.length?`<p class="note">Παρατήρηση ρυθμού: ${r.slowed.map(safe).join(', ')}</p>`:''}`:''}${!r.done&&r.publicForecastMinutes!=null?`<p class="muted">Εκτιμώμενη διάρκεια: <b>${safe(formatMovingTime(r.publicForecastMinutes))}</b> </p>`:""}${!r.done?weatherHtml(r.weather):''}${admin&&!r.done&&r.forecast?`<p class="note">Μόνο Admin · Εσωτερική πρόβλεψη: ${safe(formatMovingTime(r.forecast.minutes))} · ${safe(r.forecast.speed)} km/h · ${r.forecast.source==="history"?"Ιστορικό ("+safe(r.forecast.samples)+" βόλτες)":"Προεπιλεγμένη ταχύτητα"}</p>`:""}${admin&&!r.done?`<p class="note">Δηλώσεις: ${(r.signups||[]).map(x=>safe(x.name)).join(', ')||'Καμία'}</p>`:''}<div class="actions">${!r.done?`<button class="btn secondary" data-do="${r.mySignup?'cancelSignup':'signup'}" data-id="${r.id}">${r.mySignup?'Ακύρωση συμμετοχής':'Δήλωση συμμετοχής'}</button>${admin?`<button class="btn" data-do="finish" data-id="${r.id}">Ολοκλήρωση</button>`:''}`:''}${admin?`<button class="btn secondary" data-do="${r.done?'editDone':'editPlanned'}" data-id="${r.id}">✏️ Επεξεργασία</button>`:'' }${admin?`<button class="btn danger" data-do="delete" data-id="${r.id}">Διαγραφή</button>`:''}</div></article>`}
function home(){const next=active();return `${stats()}<h2>Προγραμματισμένες βόλτες</h2>${next.length?next.map(rideCard).join(''):'<p class="empty">Δεν υπάρχουν προγραμματισμένες βόλτες.</p>'}`}
function memberHub(){
 if(memberAccount){
  return memberProfilePage()+
   '<section class="card member-directory-cta"><button type="button" class="btn secondary" data-go="memberDirectory">👥 Δες τα μέλη της ομάδας</button></section>';
 }
 return '<h1>Το προφίλ σου</h1><section class="card member-access"><h2>🚴 Καλώς ήρθες!</h2><p class="muted">Συνδέσου για το προσωπικό σου προφίλ, τα ποδήλατα και τα σέρβις σου. Δεν χρειάζεται email.</p><div class="member-access-actions"><button type="button" class="btn" data-go="memberLogin">Σύνδεση</button><button type="button" class="btn secondary" data-go="memberRegister">+ Νέα εγγραφή</button></div><p class="note">Ήδη καταχωρισμένο μέλος; Ο Admin θα σου δώσει τον πρώτο κωδικό.</p></section><section class="card member-directory-cta"><button type="button" class="btn secondary" data-go="memberDirectory">👥 Δες τα μέλη της ομάδας</button></section>';
}
function publicMembers(){
 const ordered=[...db.publicMembers].sort((a,b)=>(Number(b.activityCount)||0)-(Number(a.activityCount)||0)||String(a.name).localeCompare(String(b.name),'el'));
 const selected=memberName(),total=Math.max(0,Number(ordered[0]?.activityTotal)||0);
 const intro=total?`<p class="member-activity-intro">Κατάταξη βάσει συμμετοχών σε όλες τις ${total} ολοκληρωμένες βόλτες της ομάδας.</p>`:'<p class="member-activity-intro">Η κατάταξη θα εμφανιστεί μετά την πρώτη ολοκληρωμένη βόλτα.</p>';
 const cards=ordered.map(person=>{
  const attended=Math.min(total,Math.max(0,Number(person.activityCount)||0));
  const pct=total?Math.round(attended/total*100):0;
  const level=total>=5?(pct>=70?'Υψηλή συμμετοχή':pct>=30?'Τακτική συμμετοχή':'Περιστασιακή συμμετοχή'):'';
  const activity=total?`<div class="member-activity"><span>Συμμετοχές <b>${attended}/${total}</b> · <b>${pct}%</b></span><div class="member-activity-km">Χλμ. ομάδας: <b>${Number(person.activityKm||0).toLocaleString('el-GR',{maximumFractionDigits:2})}</b></div><div class="member-activity-track" role="progressbar" aria-label="Ποσοστό συμμετοχής" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div></div>`:'';
  return `<article class="card member-card">${riderAvatar(person)}<div class="member-details"><strong class="rider-name">${safe(person.name)}</strong><div class="member-meta"><span class="rider-status is-member">Μέλος</span>${level?`<span class="member-activity-label">${level}</span>`:''}</div>${activity}</div><div class="member-select">${selected===person.name?'<span class="member-self">✓ Εσύ</span><button type="button" class="btn secondary" data-go="memberProfile">Το προφίλ μου</button>':'<span class="member-public-status">Προφίλ μέλους</span>'}</div></article>`;
 }).join('');
 return `<div class="member-directory-heading"><h1>👥 Μέλη ομάδας</h1><button type="button" class="btn secondary" data-go="members">← Το προφίλ μου</button></div>${intro}<div class="member-list">${cards||'<p class="empty">Δεν έχουν προστεθεί μέλη ακόμη.</p>'}</div>`;
}

function memberRegisterPage(){
 if(memberAccount)return memberProfilePage();
 return `<h1>Εγγραφή νέου μέλους</h1><section class="card member-account-page">
  <p class="muted">Δημιούργησε το προσωπικό σου προφίλ χωρίς email. Κράτησε τον κωδικό σου. Αν τον θυμάσαι, μπορείς να τον αλλάξεις μόνος σου. Ο Admin βοηθά μόνο όταν τον ξεχάσεις.</p>
  <form id="memberRegisterForm" autocomplete="on">
   <label>Όνομα ή ψευδώνυμο<input name="name" required minlength="2" maxlength="70" autocomplete="nickname" placeholder="π.χ. Κώστας ή KostasRider"></label>
   <label>Προσωπικός κωδικός<input type="password" name="password" required minlength="6" maxlength="64" autocomplete="new-password" placeholder="Τουλάχιστον 6 χαρακτήρες"></label>
   <label>Επιβεβαίωση κωδικού<input type="password" name="confirmPassword" required minlength="6" maxlength="64" autocomplete="new-password"></label>
   <div class="member-access-actions"><button class="btn" type="submit">Δημιουργία προφίλ</button><button class="btn secondary" type="button" data-go="members">Πίσω</button></div>
  </form>
 </section>`;
}
function memberLoginPage(){
 if(memberAccount)return memberProfilePage();
 return `<h1>Σύνδεση μέλους</h1><section class="card member-account-page">
  <p class="muted">Συνδέσου με το όνομα ή ψευδώνυμο και τον προσωπικό σου κωδικό.</p>
  <form id="memberLoginForm" autocomplete="on">
   <label>Όνομα ή ψευδώνυμο<input name="name" required maxlength="70" autocomplete="username" value="${safe(readLocal('voltesLastSignupName'))}"></label>
   <label>Κωδικός<input type="password" name="password" required autocomplete="current-password" minlength="6" maxlength="64"></label>
   <div class="member-access-actions"><button class="btn" type="submit">Σύνδεση</button><button class="btn secondary" type="button" data-go="memberRegister">Νέα εγγραφή</button></div>
  </form>
  <p class="note">Ξέχασες τον κωδικό; Ζήτησε από τον Admin προσωρινό κωδικό επαναφοράς, με ισχύ μία ώρα.</p>
  <button type="button" class="btn secondary" data-go="memberRecovery">Έχω κωδικό επαναφοράς</button>
 </section>`;
}
function memberRecoveryPage(){
 if(memberAccount)return memberProfilePage();
 return `<h1>Επαναφορά προσωπικού κωδικού</h1><section class="card member-account-page">
  <p class="muted">Ζήτησε έγκριση από τον Admin. Θα σου δώσει έναν προσωρινό κωδικό που ισχύει για <b>1 ώρα</b> και μόνο για μία αλλαγή.</p>
  <form id="memberRecoveryForm" autocomplete="off">
   <label>Όνομα ή ψευδώνυμο<input name="name" required maxlength="70" autocomplete="username" value="${safe(readLocal('voltesLastSignupName'))}"></label>
   <label>Προσωρινός κωδικός 1 ώρας<input name="resetCode" required maxlength="35" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="XXXXX-XXXXX-XXXXX-XXXXX"></label>
   <label>Νέος προσωπικός κωδικός<input type="password" name="newPassword" required minlength="6" maxlength="64" autocomplete="new-password"></label>
   <label>Επιβεβαίωση νέου κωδικού<input type="password" name="confirmPassword" required minlength="6" maxlength="64" autocomplete="new-password"></label>
   <div class="member-access-actions"><button type="submit" class="btn">Αποθήκευση νέου κωδικού</button><button type="button" class="btn secondary" data-go="memberLogin">Πίσω</button></div>
  </form>
  <p class="note">Ο προσωρινός κωδικός ακυρώνεται αμέσως μετά την επιτυχημένη χρήση ή όταν περάσει η μία ώρα.</p>
 </section>`;
}
function memberProfilePage(){
 if(!memberAccount)return memberLoginPage();
 const member=db.publicMembers.find(x=>x.name===memberName());
 const total=Number(member?.activityTotal||0),count=Number(member?.activityCount||0);
 const km=Number(member?.activityKm||0).toLocaleString('el-GR',{maximumFractionDigits:2});
 return `<h1>Το προφίλ μου</h1><section class="card member-profile">
  <div class="member-profile-head">${member?riderAvatar(member):'<span class="rider-avatar avatar-initials" aria-hidden="true">🚴</span>'}
   <div><h2>${safe(memberName())}</h2><p class="muted">Προσωπικό προφίλ μέλους</p></div></div>
  <div class="member-profile-metrics"><div><b>${count}/${total}</b><small>Συμμετοχές</small></div><div><b>${km}</b><small>Χλμ. ομάδας</small></div></div>
  <h3 class="profile-tools-title">Το ποδήλατό μου</h3>
  <div class="profile-tools" role="group" aria-label="Ποδήλατα και σέρβις">
   <button type="button" class="profile-tool" data-go="bikeDetails"><span aria-hidden="true">🚴</span><strong>Πληροφορίες ποδηλάτου</strong></button>
   <button type="button" class="profile-tool" data-go="bikeMaintenance"><span aria-hidden="true">🔧</span><strong>Προγραμματισμένοι έλεγχοι</strong></button>
   <button type="button" class="profile-tool" data-go="bikeService"><span aria-hidden="true">＋</span><strong>+ Νέο σέρβις</strong></button>
   <button type="button" class="profile-tool" data-go="bikeHistory"><span aria-hidden="true">◷</span><strong>Προβολή παλιών σέρβις</strong></button>
  </div>
  <details class="member-profile-options"><summary>⚙ Ρυθμίσεις προφίλ</summary>
   <label class="btn secondary avatar-picker">Αλλαγή φωτογραφίας<input type="file" accept="image/jpeg,image/png,image/webp" data-member-avatar aria-label="Φωτογραφία προφίλ"></label>
   ${member?.avatar_data_url?'<button type="button" class="btn secondary" data-do="memberRemoveAvatar">Αφαίρεση φωτογραφίας</button>':''}
   <details class="member-password-panel"><summary>Αλλαγή προσωπικού κωδικού</summary>
   <form id="memberPasswordForm">
    <label>Τρέχων κωδικός<input type="password" name="currentPassword" required minlength="6" maxlength="64" autocomplete="current-password"></label>
    <label>Νέος κωδικός<input type="password" name="newPassword" required minlength="6" maxlength="64" autocomplete="new-password"></label>
    <label>Επιβεβαίωση<input type="password" name="confirmPassword" required minlength="6" maxlength="64" autocomplete="new-password"></label>
    <button type="submit" class="btn">Αλλαγή κωδικού</button>
   </form>
   </details>
   <button type="button" class="btn secondary" data-do="memberLogout">Αποσύνδεση</button>
  </details>
 </section>`;
}
function upcoming(){return `<h1>Προγραμματισμένες βόλτες</h1>${admin?'<button class="btn" data-go="new">+ Νέα βόλτα</button>':''}${active().length?active().map(rideCard).join(''):'<p class="empty">Καμία προγραμματισμένη βόλτα.</p>'}`}
function history(){const rides=completed();return `${rides.length?rides.slice(0,historyLimit).map(rideCard).join(''):'<p class="empty">Καμία ολοκληρωμένη διαδρομή.</p>'}${rides.length>historyLimit?'<div class="actions archive-actions"><button class="btn secondary" data-do="moreHistory">Παλαιότερες διαδρομές</button></div>':''}`}
function routeChoices(){return '<option value="">Χωρίς αποθηκευμένη διαδρομή</option>'+db.routeTemplates.map(r=>'<option value="'+safe(r.id)+'">'+safe(r.name)+'</option>').join('')}

/* Four-step quick ride creation, with the date always resolved in Europe/Athens. */
let quickRideState={day:'',date:'',period:'',time:'',showTimePicker:false,routeId:'',placeMode:'mavili',customPlace:'',step:1};
function greekDay(offset=0){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Athens',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
 return new Date(Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day)+offset)).toISOString().slice(0,10);
}
function quickDate(){return quickRideState.day==='today'?greekDay():quickRideState.day==='tomorrow'?greekDay(1):quickRideState.date}
function rideDeparture(r){return r.time||({morning:'Πρωί',noon:'Μεσημέρι',afternoon:'Απόγευμα'}[r.timePeriod]||'Ώρα υπό συνεννόηση')}
function quickOption(label,field,value,active){
 return '<button type="button" class="quick-option'+(active?' selected':'')+'" data-do="quickPick" data-field="'+field+'" data-value="'+safe(value)+'" aria-pressed="'+(active?'true':'false')+'">'+safe(label)+(active?' ✓':'')+'</button>';
}
function quickCompletedStep(number,heading,answer){
 return '<div class="quick-completed"><span class="quick-completed-label"><b>'+number+'. '+safe(heading)+'</b><span>'+safe(answer)+'</span></span><button type="button" class="btn secondary quick-change" data-do="quickEdit" data-step="'+number+'">Αλλαγή</button></div>';
}
function newRide(){
 const q=quickRideState,date=quickDate(),routes=[...db.routeTemplates].sort((a,b)=>(Number(b.usageCount)||0)-(Number(a.usageCount)||0)||a.name.localeCompare(b.name,'el'));
 const chosen=routes.find(t=>t.id===q.routeId);
 const timeLabel={morning:'Πρωί',noon:'Μεσημέρι',afternoon:'Απόγευμα'};
 const when=!!date,period=!!q.period;
 const step=Math.min(Math.max(1,Number(q.step)||1),4);
 let body='';
 if(step>1&&when)body+=quickCompletedStep(1,'Ημέρα',datefmt(date));
 if(step>2&&period)body+=quickCompletedStep(2,'Αναχώρηση',(timeLabel[q.period]||'')+(q.time?' · '+q.time:' · ώρα υπό συνεννόηση'));
 if(step>3&&chosen)body+=quickCompletedStep(3,'Διαδρομή',chosen.name+(chosen.estimate?' · '+chosen.estimate+' χλμ.':''));
 if(step===1){
  body+='<section class="card quick-step"><h2>1. Πότε θα πάτε βόλτα;</h2><div class="quick-options">'+
  quickOption('Σήμερα','day','today',q.day==='today')+quickOption('Αύριο','day','tomorrow',q.day==='tomorrow')+quickOption('Γράψε ημέρα','day','other',q.day==='other')+'</div>'+
  (q.day==='other'?'<label>Ημερομηνία <input type="date" name="customDate" id="quickCustomDate" required min="'+greekDay()+'" value="'+safe(q.date)+'"></label>':'')+'</section>';
 }else if(step===2&&when){
  body+='<section class="card quick-step"><h2>2. Πότε θα ξεκινήσετε;</h2><div class="quick-options">'+
  quickOption('Πρωί','period','morning',q.period==='morning')+quickOption('Μεσημέρι','period','noon',q.period==='noon')+quickOption('Απόγευμα','period','afternoon',q.period==='afternoon')+'</div>'+
  (period?'<button type="button" class="btn secondary quick-set-time" data-do="quickToggleTime">'+(q.showTimePicker?'Χωρίς ακριβή ώρα':'🕒 Ορισμός ακριβούς ώρας')+'</button>'+(q.showTimePicker?'<label>Ακριβής ώρα αναχώρησης<input type="time" id="quickTime" name="departureTime" value="'+safe(q.time)+'"></label>':'<p class="note">Η ακριβής ώρα μένει υπό συνεννόηση.</p>')+'<button type="button" class="btn quick-next" data-do="quickNext">Επόμενο</button>':'')+'</section>';
 }else if(step===3&&when&&period){
  body+='<section class="card quick-step"><h2>3. Επιλογή διαδρομής</h2><p class="note">Πρώτες εμφανίζονται οι συχνότερες.</p><div class="quick-route-list">'+routes.map(t=>quickOption(t.name+(t.estimate?' · '+t.estimate+' χλμ.':''),'routeId',t.id,q.routeId===t.id)).join('')+'</div></section>';
 }else if(step===4&&when&&period&&chosen){
  body+='<section class="card quick-step"><h2>4. Σημείο συνάντησης</h2><div class="quick-options">'+
  quickOption('Πλατεία Μαβίλη','placeMode','mavili',q.placeMode==='mavili')+quickOption('Γράψε σημείο','placeMode','other',q.placeMode==='other')+'</div>'+
  (q.placeMode==='other'?'<label>Σημείο συνάντησης<input required maxlength="120" name="customPlace" placeholder="Γράψε το σημείο" value="'+safe(q.customPlace)+'"></label>':'<p class="note">📍 Πλατεία Μαβίλη</p>')+
  '<div class="quick-review"><strong>Έτοιμη για δημοσίευση</strong><p>📅 '+datefmt(date)+' · '+(q.time?safe(q.time):timeLabel[q.period]+' (ώρα υπό συνεννόηση)')+'</p><p>🚴 '+safe(chosen.name)+'</p></div><button class="btn" type="submit">Δημοσίευση βόλτας</button></section>';
 }
 return '<h1>🚴 Γρήγορη νέα βόλτα</h1><form id="quickRideForm">'+body+'</form><div class="actions"><button type="button" class="btn secondary" data-go="newDetailed">Περισσότερες ρυθμίσεις</button></div>';
}

function detailedRide(){return `<h1>+ Νέα βόλτα</h1><div class="card"><form id="createRide"><label>Αποθηκευμένη διαδρομή <select name="routeTemplateId" id="rideTemplateSelect">${routeChoices()}</select></label><div id="selectedRoutePoints" class="note"></div><label>Ημερομηνία <input required type="date" name="date" min="2020-01-01" value="${today()}"></label><label>Ώρα <input required type="time" name="time" value="09:00"></label><label>Σημείο συνάντησης <input id="meetingPlaceInput" required maxlength="120" name="place" placeholder="π.χ. Πλατεία Μαβίλη" autocomplete="off" aria-controls="meetingPlaceSuggestions" aria-expanded="false"></label><div id="meetingPlaceSuggestions" class="meeting-place-options" role="group" aria-label="Προηγούμενα σημεία συνάντησης" hidden></div><label>Τίτλος (προαιρετικά) <input maxlength="100" name="title" placeholder="π.χ. Γύρος λίμνης"></label><label>Τύπος διαδρομής <select name="routeType"><option value="flat">Επίπεδη — 20 km/h</option><option value="mixed">Μικτή — 12 km/h</option><option value="mountain">Ορεινή — 9 km/h</option></select></label><label>Εκτιμώμενα χιλιόμετρα (προαιρετικά) <input type="number" min="1" max="1000" step="0.1" name="estimate"></label><div id="newRideForecast" class="note" role="status"></div><button class="btn">Δημοσίευση βόλτας</button></form></div>`}
function routeEditor(){return '<h2>Στοιχεία νέας διαδρομής</h2><form id="saveRouteForm"><label>Όνομα διαδρομής <input name="name" maxlength="100" required placeholder="π.χ. Βλαχόστρατα – Αμπέλια"></label><label>Βασικά σημεία με τη σειρά (2–6, χωρισμένα με κόμμα) <textarea name="points" required rows="2" placeholder="Ιωάννινα, Βλαχόστρατα, Αμπέλια, Ιωάννινα"></textarea></label><label>Τύπος <select name="routeType"><option value="flat">Επίπεδη</option><option value="mixed">Μικτή</option><option value="mountain">Ορεινή</option></select></label><label>Χιλιόμετρα (προαιρετικά) <input name="estimate" type="number" min="1" max="1000" step="0.1"></label><button class="btn secondary">Αποθήκευση για επόμενες βόλτες</button></form>'}
function addRoutePage(){return `<h1>+ Προσθήκη διαδρομής</h1><div class="card">${routeEditor()}</div>`}
function savedRoutesPage(){
 const types={flat:'Επίπεδη',mixed:'Μικτή',mountain:'Ορεινή'};
 return `<h1>Αποθηκευμένες διαδρομές</h1><div class="actions"><button type="button" class="btn" data-go="routeAdd">+ Προσθήκη διαδρομής</button></div>${db.routeTemplates.length?db.routeTemplates.map(t=>`<article class="card"><h2>${safe(t.name)}</h2><p class="note">${(t.points||[]).map(safe).join(' → ')}</p><p class="muted">${types[t.route_type]||'Επίπεδη'}${t.estimate?' · '+safe(t.estimate)+' km':''}</p><div class="actions"><button type="button" class="btn secondary" data-do="useSavedRoute" data-id="${safe(t.id)}">Νέα βόλτα με αυτή τη διαδρομή</button><button type="button" class="btn secondary" data-do="editRoute" data-id="${safe(t.id)}">Επεξεργασία</button></div></article>`).join(''):'<p class="empty">Δεν υπάρχουν αποθηκευμένες διαδρομές.</p>'}`;
}
function editRoutePage(){
 const t=db.routeTemplates.find(x=>x.id===window.currentRouteId);
 if(!t)return '<p class="alert">Η διαδρομή δεν βρέθηκε.</p>';
 const types=[['flat','Επίπεδη'],['mixed','Μικτή'],['mountain','Ορεινή']];
 return `<h1>Επεξεργασία διαδρομής</h1><div class="card"><form id="editRouteForm" data-id="${safe(t.id)}"><label>Όνομα διαδρομής <input name="name" maxlength="100" required value="${safe(t.name)}"></label><label>Βασικά σημεία (2–6, με κόμμα)<textarea name="points" rows="3" required>${safe((t.points||[]).join(', '))}</textarea></label><label>Τύπος <select name="routeType">${types.map(([id,label])=>`<option value="${id}" ${t.route_type===id?'selected':''}>${label}</option>`).join('')}</select></label><label>Εκτιμώμενα χιλιόμετρα <input name="estimate" type="number" min="1" max="1000" step="0.01" value="${safe(t.estimate??'')}"></label><button type="submit" class="btn">Αποθήκευση αλλαγών</button><button type="button" class="btn secondary" data-go="routes">Ακύρωση</button></form></div>`;
}
function meetingPlaceOptions(){
 const names=['Πλατεία Μαβίλη',...db.rides.map(r=>r.place)];
 const unique=new Map();
 for(const raw of names){const name=String(raw||'').trim();if(!name||name==='Ιστορική βόλτα')continue;const key=name.toLocaleLowerCase('el-GR');if(!unique.has(key))unique.set(key,name)}
 return [...unique.values()];
}
function updateMeetingPlaceOptions(){
 const field=document.querySelector('#meetingPlaceInput'),box=document.querySelector('#meetingPlaceSuggestions');
 if(!field||!box)return;
 const query=field.value.trim().toLocaleLowerCase('el-GR');
 const matched=meetingPlaceOptions().filter(name=>name.toLocaleLowerCase('el-GR').includes(query)).slice(0,15);
 box.innerHTML=matched.map(name=>`<button class="btn secondary" type="button" data-place-pick="${safe(name)}">${safe(name)}</button>`).join('');
 box.hidden=!matched.length;field.setAttribute('aria-expanded',String(!box.hidden));
}
function syncRouteChoice(){
 const f=document.querySelector('#createRide');if(!f)return;
 const chosen=db.routeTemplates.find(x=>x.id===f.elements.namedItem('routeTemplateId').value);
 const area=document.querySelector('#selectedRoutePoints');
 if(!chosen){if(area)area.textContent='';return}
 f.elements.namedItem('title').value=chosen.name;
 f.elements.namedItem('routeType').value=chosen.route_type;
 f.elements.namedItem('estimate').value=chosen.estimate??'';
 if(area)area.textContent='Σημεία: '+(chosen.points||[]).join(' → ');
 updateNewRideForecast();
}
async function submitRideSignup(id,name){
 if(!name)return;
 signupTokens[id] ||= newToken();
 if(!saveSignupTokens()){toast('Δεν επιτρέπεται η αποθήκευση στη συσκευή. Χρειάζεται για την ακύρωση συμμετοχής.');return}
 try{
  await api('signup',{id,name,cancelToken:signupTokens[id]});
  writeLocal('voltesLastSignupName',name);
  await refresh();navigate('home');
 }catch(err){toast(err.message)}
}
function signup(r){return `<h1>Δήλωση συμμετοχής</h1><div class="card"><h2>${safe(r.title||'Ποδηλατική βόλτα')}</h2><p class="muted">${datefmt(r.date)} · ${safe(rideDeparture(r))} · ${safe(r.place)}</p><form id="signupForm" data-id="${r.id}"><label>Το όνομά σου <input required maxlength="70" name="name" autocomplete="name" value="${safe(memberName()||readLocal('voltesLastSignupName'))}" placeholder="Όνομα και επώνυμο"></label><button class="btn">Θα συμμετέχω</button></form><p class="note">Το όνομα θα είναι ορατό μόνο στους Admin. Η δήλωση αποθηκεύεται στην κοινή βάση της ομάδας.</p></div>`}
function finish(r){let names=[...new Set([...(r.signups||[]).map(x=>x.name),...db.riders.map(x=>x.name)])];return `<h1>Ολοκλήρωση βόλτας</h1><div class="card"><h2>${safe(r.title||'Ποδηλατική βόλτα')}</h2><form id="finishForm" data-id="${r.id}"><div class="ocr-box"><label>Screenshot από Strava (προαιρετικά) <input id="stravaScreenshot" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="stravaOcrHelp"></label><p id="stravaOcrHelp" class="note">Η εικόνα διαβάζεται στη συσκευή σου. Έλεγξε και διόρθωσε τις τιμές πριν αποθηκεύσεις.</p><p id="stravaOcrStatus" class="note" role="status"></p></div><label>Πραγματική απόσταση (km) <input required name="km" type="number" min="0.1" max="1000" step="0.01"></label><label>Κοινή μέση ταχύτητα (km/h) <input required name="speed" type="number" min="1" max="100" step="0.1"></label><label>Υψομετρική ανάβαση (m) <input required name="elevationGain" type="number" min="0" max="50000" step="1" inputmode="numeric"></label><label>Χρόνος κίνησης (ώρες:λεπτά) <input required name="movingTime" type="text" inputmode="text" pattern="[0-9]{1,3}:[0-5][0-9]" placeholder="1:40" maxlength="6" aria-describedby="movingTimeHelp"></label><p id="movingTimeHelp" class="note">Μόνο ο χρόνος κίνησης από το Strava, χωρίς στάσεις (π.χ. 1:40).</p><label>Σύνδεσμος Strava (προαιρετικά) <input name="strava" type="url" placeholder="https://www.strava.com/activities/..."></label><p>Πραγματικοί συμμετέχοντες — επιλέξτε όσους ήρθαν</p>${names.length?names.map((n,i)=>`<label class="check"><input type="checkbox" name="person" value="${safe(n)}" ${(r.signups||[]).some(s=>s.name===n)?'checked':''}>${safe(n)}</label>`).join(''):'<p class="note">Δεν υπάρχουν ακόμη συμμετέχοντες. Πρόσθεσέ τους πρώτα από το μητρώο ποδηλατών.</p>'}<label>Ποιος δυσκολεύτηκε να ακολουθήσει; (προαιρετικά, μόνο Admin)</label>${names.map(n=>`<label class="check"><input type="checkbox" name="slowed" value="${safe(n)}">${safe(n)}</label>`).join('')}<label>Ιδιωτική παρατήρηση Admin (προαιρετικά)<textarea name="slowdownNotes" maxlength="2000" rows="3" placeholder="Σημείωση για τον ρυθμό των επιλεγμένων συμμετεχόντων"></textarea></label>${!completionV2?'<p class="alert">Απαιτείται ενημέρωση του backend πριν αποθηκευτούν τα νέα στοιχεία. Η βόλτα δεν έχει αλλάξει.</p>':''}<button class="btn" ${!completionV2?'disabled':''}>Αποθήκευση στο ιστορικό</button></form></div>`}
function historicalRide(){
 const base=finish({title:'Παλιά βόλτα',signups:[]});
 const extras=`<label>Ημερομηνία βόλτας <input type="date" name="date" required min="2000-01-01" max="${today()}"></label><label>Ώρα εκκίνησης <input type="time" name="time" required value=""></label><label>Αποθηκευμένη διαδρομή <select name="routeTemplateId" id="historicalTemplateSelect">${routeChoices()}</select></label><p id="historicalRoutePreview" class="note"></p><label>Τίτλος (προαιρετικά) <input name="title" maxlength="100" placeholder="π.χ. Γύρος Λίμνης"></label><p class="note">Τα σημεία της διαδρομής είναι ενδεικτικά· οι παρακάμψεις και τα επιπλέον χιλιόμετρα επιτρέπονται.</p>`;
 return base.replace('<h1>Ολοκλήρωση βόλτας</h1>','<h1>+ Προσθήκη παλιάς βόλτας</h1>').replace('<h2>Παλιά βόλτα</h2>','<p class="note">Μόνο Admin · Καταχώριση διαδρομής χωρίς προηγούμενο προγραμματισμό.</p>').replace('id="finishForm" data-id="undefined"','id="historicalForm"').replace('</div><label>Πραγματική απόσταση', '</div>'+extras+'<label>Πραγματική απόσταση');
}
function syncHistoricalRoute(){
 const f=document.querySelector('#historicalForm');if(!f)return;
 const t=db.routeTemplates.find(x=>x.id===f.elements.namedItem('routeTemplateId').value);
 const preview=document.querySelector('#historicalRoutePreview');
 if(t){f.elements.namedItem('title').value=t.name;if(preview)preview.textContent='Βασικά σημεία: '+(t.points||[]).join(' → ')}
 else if(preview)preview.textContent='';
}
function editPlannedRide(r){
 if(!admin||!r||r.done)return '<p class="alert">Η βόλτα δεν είναι διαθέσιμη για επεξεργασία.</p>';
 const options='<option value="keep">Διατήρηση υπάρχουσας διαδρομής</option><option value="">Χωρίς αποθηκευμένη διαδρομή</option>'+db.routeTemplates.map(t=>'<option value="'+safe(t.id)+'">'+safe(t.name)+'</option>').join('');
 return `<h1>✏️ Επεξεργασία βόλτας</h1><section class="card"><form id="editPlannedForm" data-id="${safe(r.id)}"><div class="ride-metrics"><label>Ημερομηνία<input name="date" type="date" required value="${safe(r.date)}"></label><label>Ακριβής ώρα<input name="time" type="time" value="${safe(r.time||'')}"></label></div><label>Μέρος ημέρας<select name="timePeriod">${[['','Χωρίς επιλογή'],['morning','Πρωί'],['noon','Μεσημέρι'],['afternoon','Απόγευμα']].map(([v,l])=>'<option value="'+v+'" '+((r.timePeriod||'')===v?'selected':'')+'>'+l+'</option>').join('')}</select></label><p class="note">Η ακριβής ώρα ενεργοποιεί τον έλεγχο καιρού 30 λεπτά πριν.</p><label>Σημείο συνάντησης<input name="place" required maxlength="120" value="${safe(r.place||'')}"></label><label>Διαδρομή<select name="routeTemplateId" id="plannedRouteSelect">${options}</select></label><label>Τίτλος<input name="title" required maxlength="100" value="${safe(r.title||'Ποδηλατική βόλτα')}"></label><label>Τύπος<select name="routeType">${[['flat','Επίπεδη'],['mixed','Μικτή'],['mountain','Ορεινή']].map(([v,l])=>'<option value="'+v+'" '+(r.routeType===v?'selected':'')+'>'+l+'</option>').join('')}</select></label><label>Εκτιμώμενα χιλιόμετρα<input type="number" min="1" max="1000" step="0.01" name="estimate" value="${safe(r.estimate??'')}"></label><p class="note">Οι υπάρχουσες συμμετοχές διατηρούνται.</p><div class="actions"><button type="submit" class="btn">Αποθήκευση</button><button type="button" class="btn secondary" data-go="home">Ακύρωση</button></div></form></section>`;
}
function editCompletedRide(r){
 if(!admin||!r?.done)return '<p class="alert">Η βόλτα δεν είναι διαθέσιμη για επεξεργασία.</p>';
 const choices=[...new Set([...db.riders.map(x=>x.name),...(r.attendees||[])])];
 const chosenId=r.routeTemplateId||'';
 const optionHtml='<option value="">Χωρίς αποθηκευμένη διαδρομή</option>'+db.routeTemplates.map(t=>`<option value="${safe(t.id)}" ${t.id===chosenId?'selected':''}>${safe(t.name)}</option>`).join('');
 const currentPoints=Array.isArray(r.routePoints)?r.routePoints.join(', '):'';
 return `<h1>Επεξεργασία βόλτας</h1><div class="card"><p class="muted">📅 ${datefmt(r.date)} · ${safe(r.time||'')} · ${safe(r.km)} km</p><form id="editCompletedForm" data-id="${safe(r.id)}"><label>Τίτλος βόλτας <input type="text" name="title" maxlength="100" required value="${safe(r.title||'Ποδηλατική βόλτα')}"></label><label>Αποθηκευμένη διαδρομή <select name="routeTemplateId" id="editRouteTemplateSelect">${optionHtml}</select></label><label>Βασικά σημεία (χωρισμένα με κόμμα, έως 6) <textarea name="points" rows="3" placeholder="Ιωάννινα, Ανατολή, Κατσικάς, Λογγάδες, Πέραμα, Ιωάννινα">${safe(currentPoints)}</textarea></label><p class="note">Τα σημεία είναι ενδεικτικά. Η αλλαγή αφορά μόνο αυτή τη βόλτα, όχι την αποθηκευμένη διαδρομή.</p><label>Τύπος διαδρομής <select name="routeType"><option value="flat" ${r.routeType==='flat'?'selected':''}>Επίπεδη</option><option value="mixed" ${r.routeType==='mixed'?'selected':''}>Μικτή</option><option value="mountain" ${r.routeType==='mountain'?'selected':''}>Με σημαντική ανηφόρα</option></select></label><p><strong>Ποιοι συμμετείχαν πραγματικά;</strong></p>${choices.map(n=>`<label class="check"><input name="person" type="checkbox" value="${safe(n)}" ${(r.attendees||[]).includes(n)?'checked':''}>${safe(n)}</label>`).join('')||'<p class="note">Δεν υπάρχουν ποδηλάτες στο μητρώο.</p>'}<p class="note">Αν αφαιρέσεις συμμετέχοντα, θα ενημερωθούν αυτόματα τα στατιστικά του.</p><div class="actions"><button class="btn" type="submit">Αποθήκευση αλλαγών</button><button class="btn secondary" type="button" data-go="history">Ακύρωση</button></div></form></div>`;
}
function syncEditRouteChoice(){
 const form=document.querySelector('#editCompletedForm');if(!form)return;
 const template=db.routeTemplates.find(t=>t.id===form.elements.namedItem('routeTemplateId').value);
 if(!template)return;
 form.elements.namedItem('title').value=template.name;
 form.elements.namedItem('points').value=(template.points||[]).join(', ');
 form.elements.namedItem('routeType').value=template.route_type;
}
function riders(){let r=db.riders;return `<h1>Ποδηλάτες & επισκέπτες</h1>
 ${adminIssuedRecovery?'<section class="card member-reset-code" role="status" aria-label="Προσωρινός κωδικός επαναφοράς"><h2>Έγκριση 1 ώρας · '+safe(adminIssuedRecovery.memberName)+'</h2><p>Δώσε ιδιωτικά αυτόν τον προσωρινό κωδικό στο μέλος. Θα λειτουργήσει μία φορά και θα λήξει σε μία ώρα.</p><div class="member-reset-value">'+safe(adminIssuedRecovery.code)+'</div><div class="member-access-actions"><button type="button" class="btn" data-do="copyMemberReset">Αντιγραφή κωδικού</button><button type="button" class="btn secondary" data-do="hideMemberReset">Κλείσιμο</button></div><p class="note">Ισχύει έως: '+safe(new Date(adminIssuedRecovery.expiresAt).toLocaleString("el-GR",{dateStyle:"short",timeStyle:"short"}))+'</p></section>':''}<div class="card"><form id="addRider"><label>Όνομα <input name="name" required maxlength="70" placeholder="Όνομα και επώνυμο"></label><fieldset class="rider-type-choice"><legend>Τύπος ποδηλάτη</legend><label class="check"><input type="radio" name="riderType" value="member" checked>Μέλος</label><label class="check"><input type="radio" name="riderType" value="visitor">Επισκέπτης</label></fieldset><button class="btn">Προσθήκη ποδηλάτη</button></form></div><div class="member-list">${r.length?r.map(x=>`<article class="card member-card admin-member-card">${riderAvatar(x)}<div class="rider-identity"><strong class="rider-name">${safe(x.name)}</strong><span class="rider-status ${x.member?'is-member':'is-guest'}">${x.member?'Μέλος':'Επισκέπτης'}</span><button type="button" class="btn secondary member-type-toggle" data-do="toggleMember" data-id="${safe(x.id)}">Αλλαγή τύπου</button></div><div class="rider-actions"><label class="btn secondary avatar-picker">${x.avatar_data_url?'Αλλαγή φωτογραφίας':'Προσθήκη φωτογραφίας'}<input type="file" accept="image/jpeg,image/png,image/webp" data-avatar-id="${safe(x.id)}" aria-label="Φωτογραφία για ${safe(x.name)}"></label>${x.avatar_data_url?`<button class="btn secondary" data-do="removeAvatar" data-id="${safe(x.id)}">Αφαίρεση φωτογραφίας</button>`:''} ${x.member?(memberCredentialIds===null?'<span class="note">Έλεγχος σύνδεσης μέλους…</span>':memberCredentialIds.has(x.id)?'<button type="button" class="btn secondary" data-do="adminMemberReset" data-id="'+safe(x.id)+'">Έγκριση αλλαγής κωδικού · 1 ώρα</button>':'<button type="button" class="btn secondary" data-do="adminMemberPassword" data-id="'+safe(x.id)+'">Ορισμός πρώτου κωδικού</button>'):''}<button class="btn danger" data-do="deleteRider" data-id="${safe(x.id)}">Διαγραφή</button></div></article>`).join(''):'<p class="muted">Δεν υπάρχουν καταχωρισμένοι ποδηλάτες.</p>'}</div>`}
function riderAvatar(r){const initials=r.name.trim().split(/\s+/).slice(0,2).map(n=>Array.from(n)[0]).join('').toLocaleUpperCase('el');return r.avatar_data_url&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(r.avatar_data_url)?`<img class="rider-avatar" src="${safe(r.avatar_data_url)}" alt="Φωτογραφία ${safe(r.name)}" width="56" height="56">`:`<span class="rider-avatar avatar-initials" aria-hidden="true">${safe(initials)}</span>`}
async function prepareAvatar(file){
 if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('Επίλεξε φωτογραφία JPG, PNG ή WebP έως 10 MB.');
 const image=await createImageBitmap(file);try{const canvas=document.createElement('canvas');canvas.width=192;canvas.height=192;const context=canvas.getContext('2d');context.fillStyle='#19251d';context.fillRect(0,0,192,192);const side=Math.min(image.width,image.height);context.drawImage(image,(image.width-side)/2,(image.height-side)/2,side,side,0,0,192,192);const result=canvas.toDataURL('image/jpeg',0.82);if(result.length>90000)throw Error('Η φωτογραφία είναι πολύ μεγάλη. Επίλεξε άλλη.');return result}finally{image.close()}
}
app.addEventListener('change',async e=>{
 const input=e.target;
 if(input.id!=='stravaScreenshot'||!input.files?.length||!admin)return;
 const form=input.closest('form'),status=form?.querySelector('#stravaOcrStatus');
 if(!form||!status)return;
 if(form.id==='historicalForm'){for(const key of ['date','time']){const field=form.elements.namedItem(key);if(field)field.value=''}}
 input.disabled=true;status.textContent='Ανάγνωση εικόνας Strava v40…';
 try{
  if(!globalThis.VoltesStravaOCR)throw Error('Δεν φορτώθηκε το εργαλείο ανάγνωσης.');
  const result=await globalThis.VoltesStravaOCR.read(input.files[0],p=>{status.textContent='Αναγνώριση: '+p+'%'},{activityDate:form.id==='historicalForm'});
  const entries=[['km',result.km],['speed',result.speed],['elevationGain',result.elevationGain],['movingTime',result.movingTime],...(form.id==='historicalForm'?[['date',result.date],['time',result.startTime]]:[])];
  let count=0;
  for(const [name,value] of entries){if(value!=null){const field=form.elements.namedItem(name);if(field){field.value=String(value);count++}}}
  if(form.id==='historicalForm'){
   const dateLabel=result.date?new Date(result.date+'T12:00:00').toLocaleDateString('el-GR',{day:'numeric',month:'long',year:'numeric'}):'δεν αναγνωρίστηκε';
   const clockLabel=result.startTime||'δεν αναγνωρίστηκε';
   status.textContent='Strava OCR v40 · Ημερομηνία: '+dateLabel+' · Ώρα έναρξης: '+clockLabel+(result.startTime?'. Έλεγξε τις τιμές πριν αποθηκεύσεις.':'. Δεν θα μπει αυτόματα 09:00· συμπλήρωσε την πραγματική ώρα χειροκίνητα.');
  }else{
   status.textContent=count?'Συμπληρώθηκαν '+count+'/'+entries.length+' πεδία. Επιβεβαίωσε τις τιμές από το Strava πριν την αποθήκευση.':'Δεν αναγνωρίστηκαν με σιγουριά τα στοιχεία. Συμπλήρωσέ τα χειροκίνητα.';
  }
 }catch(err){status.textContent=err.message||'Αποτυχία ανάγνωσης. Συμπλήρωσε χειροκίνητα.'}
 finally{input.disabled=false}
});
app.addEventListener('change',async e=>{const input=e.target;if(!input.dataset.avatarId||!admin||!input.files?.length)return;input.disabled=true;try{const avatar=await prepareAvatar(input.files[0]);await perform('setAvatar',{id:input.dataset.avatarId,avatar},'Η φωτογραφία αποθηκεύτηκε.')}catch(err){toast(err.message)}finally{input.disabled=false;input.value=''}});

app.addEventListener('change',async e=>{
 const input=e.target;
 if(!input.matches?.('[data-member-avatar]')||!input.files?.length||!memberAccount)return;
 input.disabled=true;
 try{
  const avatar=await prepareAvatar(input.files[0]);
  await memberApi('setAvatar',{avatar});await refresh();navigate('memberProfile');
 }catch(err){toast(err.message||'Η φωτογραφία δεν αποθηκεύτηκε.')}
 finally{input.disabled=false;input.value=''}
});
function analytics(){let list=db.riders.map(p=>{let rides=completed().filter(r=>(r.attendees||[]).includes(p.name));let total=rides.reduce((s,r)=>s+Number(r.km),0);return {name:p.name,count:rides.length,km:total,elevation:rides.some(r=>r.elevationGain!=null)?rides.reduce((s,r)=>s+Number(r.elevationGain||0),0):null,moving:rides.some(r=>r.movingMinutes!=null)?rides.reduce((s,r)=>s+Number(r.movingMinutes||0),0):null,mean:rides.length?rides.reduce((s,r)=>s+Number(r.speed),0)/rides.length:0}}).sort((a,b)=>b.km-a.km);return `<h1>Στατιστικά ποδηλατών</h1><p class="alert">Ο κοινός μέσος όρος των διαδρομών δεν αποτελεί μέτρηση ατομικής ταχύτητας. Δεν παράγεται ακόμη αυτόματη κατάταξη.</p>${list.length?list.map(p=>`<article class="card"><div class="row"><strong>${safe(p.name)}</strong><span>${p.count} βόλτες</span></div><p>${p.km.toFixed(1)} km · Μ.Ο. ομάδων ${p.count?p.mean.toFixed(1)+' km/h':'—'}</p><p class="muted">Καταγεγραμμένη ανάβαση: ${p.elevation==null?'—':safe(p.elevation)+' m'} · Χρόνος κίνησης: ${p.moving==null?'—':safe(formatMovingTime(p.moving))}</p></article>`).join(''):'<p class="empty">Πρόσθεσε μέλη και ολοκληρωμένες βόλτες για να εμφανιστούν στατιστικά.</p>'}`}
function auth(){return `<h1>Είσοδος Admin</h1><div class="card"><form id="login"><label>PIN Admin <input type="password" name="pin" required inputmode="numeric" maxlength="4" minlength="4" pattern="[0-9]{4}" placeholder="••••"></label><button class="btn">Είσοδος</button></form></div>`}
function render(){if(!admin&&['new','newDetailed','riders','stats','finish','historyAdd','editDone','editPlanned','routeAdd','routes','routeEdit','trash','backup'].includes(route))route='home';document.querySelector('#adminNav').classList.toggle('hidden',!admin);document.querySelector('#authBtn').textContent=admin?'Αποσύνδεση Admin':'Είσοδος Admin';let html=route==='backup'?backupPage():route==='trash'?trashPage():route==='settings'?themeSettings():route==='bikeService'?bikeServicePage():route==='bikeHistory'?bikeServicePage('history'):route==='bikeMaintenance'?bikeMaintenancePage():route==='bikeDetails'?bikeDetailsPage():route==='home'?home():route==='members'?memberHub():route==='memberDirectory'?publicMembers():route==='memberRegister'?memberRegisterPage():route==='memberLogin'?memberLoginPage():route==='memberRecovery'?memberRecoveryPage():route==='memberProfile'?memberProfilePage():route==='upcoming'?upcoming():route==='history'?history():route==='new'?newRide():route==='newDetailed'?detailedRide():route==='routeAdd'?addRoutePage():route==='routes'?savedRoutesPage():route==='routeEdit'?editRoutePage():route==='historyAdd'?historicalRide():route==='editPlanned'&&window.currentRide&&admin?editPlannedRide(window.currentRide):route==='editDone'&&window.currentRide&&admin?editCompletedRide(window.currentRide):route==='riders'?riders():route==='stats'?analytics():route==='auth'?auth():route==='signup'&&window.currentRide?signup(window.currentRide):route==='finish'&&window.currentRide&&admin?finish(window.currentRide):home();app.innerHTML=renderNotice()+html;message='';syncBottomNav();window.VoltesPush?.updateUi()}
const bottomNav=document.querySelector('#bottomNav');
// Keep the Profile tab selected throughout its private screens; Admin tools stay in Settings.
const profileRoutes=new Set(['members','memberDirectory','memberRegister','memberLogin','memberRecovery','memberProfile','bikeService','bikeHistory','bikeMaintenance','bikeDetails']);
function syncBottomNav(){
 const current=profileRoutes.has(route)?'members':route==='home'||route==='upcoming'||route==='signup'?'home':route==='history'?'history':'menu';
 bottomNav.querySelectorAll('button').forEach(b=>{
  const selected=b.dataset.bottomRoute===current;
  b.classList.toggle('active',selected);
  if(selected)b.setAttribute('aria-current','page');
  else b.removeAttribute('aria-current');
 });
}
bottomNav.addEventListener('click',async e=>{
 const b=e.target.closest('button[data-bottom-route]');if(!b)return;
 const page=b.dataset.bottomRoute;
 if(page==='menu'){navigate('settings');return}
 navigate(page);
 // The current page opens immediately; fresh server data is then loaded.
 // If the connection fails, retain the page and show a visible error.
 if(page==='home'||page==='members'){
  try{await refresh()}catch(err){toast('Δεν ήταν δυνατή η ανανέωση: '+err.message)}
 }
});


/* Horizontal touch navigation across the four principal tabs. Vertical scrolling remains native. */
const swipeTabs=['home','members','history','settings'];
const swipeShell=document.querySelector('.shell');
let swipeStart=null;
function swipeBlocked(target){
 return !!(target instanceof Element&&target.closest('input,select,textarea,button,a,label,form,iframe,video,audio,[contenteditable],[data-no-swipe],[role="slider"],[role="tablist"],.meeting-place-options'));
}
swipeShell.addEventListener('touchstart',e=>{
 swipeStart=null;
 if(e.touches.length!==1||!swipeTabs.includes(route)||swipeBlocked(e.target))return;
 const t=e.touches[0];
 // Leave the outer edge free for the browser's back/forward gesture.
 if(t.clientX<24||t.clientX>window.innerWidth-24)return;
 swipeStart={x:t.clientX,y:t.clientY,time:Date.now()};
},{passive:true});
swipeShell.addEventListener('touchend',e=>{
 if(!swipeStart||e.changedTouches.length!==1)return;
 const from=swipeStart;swipeStart=null;
 if(!swipeTabs.includes(route)||swipeBlocked(e.target))return;
 const t=e.changedTouches[0],dx=t.clientX-from.x,dy=t.clientY-from.y;
 if(Math.abs(dx)<70||Math.abs(dx)<Math.abs(dy)*1.6||Date.now()-from.time>1000)return;
 const index=swipeTabs.indexOf(route),next=index+(dx<0?1:-1);
 if(next<0||next>=swipeTabs.length)return;
 const target=swipeTabs[next]==='settings'?'menu':swipeTabs[next];
 bottomNav.querySelector('button[data-bottom-route="'+target+'"]')?.click();
},{passive:true});
swipeShell.addEventListener('touchcancel',()=>{swipeStart=null},{passive:true});

nav.addEventListener('click',async e=>{let b=e.target.closest('button');if(!b)return;if(b.dataset.route)navigate(b.dataset.route);else if(b.id==='authBtn'){if(admin){try{await api('logout')}catch{toast('Η σύνδεση αφαιρέθηκε από αυτή τη συσκευή. Η υπηρεσία δεν ήταν διαθέσιμη.')}finally{admin=false;pin='';adminToken='';writeLocal('voltesAdminToken','');try{await refresh()}catch{db.riders=[];db.rides=[]}navigate('home')}}else navigate('auth')}});

/* Read selected backup only in memory. No restore happens until Admin confirms. */
app.addEventListener('change',async e=>{
 const field=e.target;
 if(field.id!=='voltesBackupFile'||!admin)return;
 backupDraft=null;backupFilename='';
 const file=field.files?.[0];
 if(!file){render();return}
 try{
  if(file.size>5000000)throw Error('Το αρχείο υπερβαίνει τα 5 MB.');
  const text=await file.text();
  const data=JSON.parse(text);
  inspectBackup(data);
  backupDraft=data;
  backupFilename=file.name.slice(0,180);
 }catch(err){toast('Το αρχείο δεν έγινε δεκτό: '+(err?.message||'Άγνωστο σφάλμα'));return}
 render();
});

app.addEventListener('click',async e=>{
 let b=e.target.closest('button');if(!b)return;
 if(b.dataset.do==='cancelBikeDetailsField'){bikeDetailsFieldKey='';render();return}
 if(b.dataset.do==='editBikeDetails'){
  const bike=ownBikes().find(x=>x.id===b.dataset.bikeId);
  if(bike){
   bikeDetailsEditId=bikeDetailsEditId===bike.id?'':bike.id;
   bikeDetailsFieldKey='';
   render();
  }
  return;
 }
 if(b.dataset.do==='pickBikeDetailsField'){
  const key=b.dataset.field;
  if(bikeDetailsEditId===b.dataset.bikeId&&
     (bikeDetailFields.some(([field])=>field===key)||key==='frontBar'||key==='rearBar')){
   bikeDetailsFieldKey=key;render();
   document.querySelector('#bikeDetailsValue')?.focus({preventScroll:true});
  }
  return;
 }
 if(b.dataset.do==='cancelMaintenanceEdit'){maintenanceEditId='';render();return}
 if(b.dataset.do==='newMaintenance'){maintenanceEditId='new:'+b.dataset.bikeId;render();return}
 if(b.dataset.do==='editMaintenance'){maintenanceEditId=b.dataset.id;render();return}
 if(b.dataset.do==='completeMaintenance'){
  if(confirm('Έγινε η εργασία; Θα ξεκινήσει νέο διάστημα και θα μπει στο ιστορικό σέρβις.'))
   await bikeAction('completeMaintenance',{bikeId:b.dataset.bikeId,id:b.dataset.id},'Η εργασία καταχωρίστηκε.');
  return;
 }
 if(b.dataset.do==='deleteMaintenance'){
  if(confirm('Να διαγραφεί η προγραμματισμένη εργασία; Το παλιό ιστορικό δεν διαγράφεται.'))
   await bikeAction('deleteMaintenance',{bikeId:b.dataset.bikeId,id:b.dataset.id},'Η εργασία διαγράφηκε.');
  return;
 }

 if(b.dataset.do==='bikeWizardEdit'){
  const step=Number(b.dataset.step);if(step>=1&&step<=3&&step<bikeWizard.step){bikeWizard.step=step;render()}return;
 }
 if(b.dataset.do==='bikeWizardNew'){bikeWizard.newBike=true;render();document.querySelector('#bikeWizardNewName')?.focus();return}
 if(b.dataset.do==='bikeWizardSaveBike'){
  const name=document.querySelector('#bikeWizardNewName')?.value?.trim()||'';
  if(name.length<2||name.length>90){toast('Γράψε όνομα ποδηλάτου (2–90 χαρακτήρες).');return}
  if(await bikeAction('createBike',{name})){bikeWizard.bike=name;bikeWizard.newBike=false;bikeWizard.step=2;render()}return;
 }
 if(b.dataset.do==='bikeWizardDefault'){
  const bike=bikeByName(bikeWizard.bike);if(bike)await bikeAction('setDefault',{bikeId:bike.id},'Το προεπιλεγμένο ποδήλατο ενημερώθηκε.');return;
 }
 if(b.dataset.do==='bikeWizardPick'){
  const field=b.dataset.field,val=b.dataset.value;
  if(field==='bike'){const found=registeredBikes().find(name=>name.toLocaleLowerCase('el-GR')===String(val||'').trim().toLocaleLowerCase('el-GR'));if(found){bikeWizard.bike=found;bikeWizard.newBike=false;bikeWizard.step=2;render()}else toast('Το ποδήλατο δεν βρέθηκε. Δοκίμασε ξανά.');return}
  if(field==='date'){
   if(val==='other'){bikeWizard.date='';render();return}
   if(val===greekDay()){bikeWizard.date=val;render();return}
  }
  if(field==='work'&&serviceWorks.includes(val)){bikeWizard.work=val;bikeWizard.step=4;render();return}
  return;
 }
 if(b.dataset.do==='bikeWizardNext'){
  const q=bikeWizard;
  if(q.step===1&&q.bike&&!q.newBike&&registeredBikes().includes(q.bike)){q.step=2;render();return}
  if(q.step===2){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(q.date)||q.date>greekDay()||!Number.isFinite(Date.parse(q.date+'T12:00:00Z'))){toast('Επίλεξε έγκυρη ημερομηνία σέρβις.');return}
   q.step=3;render();return;
  }
  return;
 }
 if(b.dataset.do==='editBikeService'){
  const item=bikeCloud.services.find(x=>x.id===b.dataset.id),bike=bikeCloud.bikes.find(x=>x.id===item?.bike_id);
  if(!item||!bike||bike.member_name!==memberName())return;
  navigate('bikeService');bikeWizard={step:4,bike:bike.name,newBike:false,date:item.service_date,work:item.work,km:item.km??'',notes:item.notes||'',editId:item.id};render();return;
 }
 if(b.dataset.do==='deleteBikeService'){
  const item=bikeCloud.services.find(x=>x.id===b.dataset.id),bike=bikeCloud.bikes.find(x=>x.id===item?.bike_id);
  if(!item||!bike||bike.member_name!==memberName())return;
  if(confirm('Να διαγραφεί αυτή η καταχώριση σέρβις;'))await bikeAction('deleteService',{bikeId:bike.id,id:item.id},'Η καταχώριση διαγράφηκε.');
  return;
 }
 if(b.dataset.do==='quickEdit'){
  const step=Number(b.dataset.step);
  if(step>=1&&step<=3&&quickRideState.step>step){quickRideState.step=step;if(step===2)quickRideState.showTimePicker=!!quickRideState.time;render()}return;
 }
 if(b.dataset.do==='quickToggleTime'){
  if(quickRideState.step===2&&quickRideState.period){if(quickRideState.showTimePicker)quickRideState.time='';quickRideState.showTimePicker=!quickRideState.showTimePicker;render()}return;
 }
 if(b.dataset.do==='quickNext'){
  if(quickRideState.step===2&&quickRideState.period){quickRideState.time=quickRideState.showTimePicker?(document.querySelector('#quickTime')?.value||''):'';quickRideState.step=3;render()}return;
 }
 if(b.dataset.do==='quickPick'){
  const f=b.dataset.field,value=b.dataset.value;
  if(!['day','period','routeId','placeMode'].includes(f))return;
  quickRideState[f]=value;
  if(f==='day'){quickRideState.date='';quickRideState.period='';quickRideState.time='';quickRideState.showTimePicker=false;quickRideState.routeId='';quickRideState.placeMode='mavili';quickRideState.customPlace='';quickRideState.step=value==='other'?1:2}
  if(f==='period'){quickRideState.time='';quickRideState.showTimePicker=false;quickRideState.step=2}
  if(f==='routeId'){quickRideState.placeMode='mavili';quickRideState.customPlace='';quickRideState.step=4}
  if(f==='placeMode'){quickRideState.customPlace=''}
  render();return;
 }

 if(b.dataset.theme){setTheme(b.dataset.theme);render();return}
 if(b.dataset.placePick){const field=document.querySelector('#meetingPlaceInput'),box=document.querySelector('#meetingPlaceSuggestions');if(field){field.value=b.dataset.placePick;field.setAttribute('aria-expanded','false');if(box)box.hidden=true}return}
 if(b.dataset.go){navigate(b.dataset.go);return}
 if(!b.dataset.do)return;
 let r=db.rides.find(x=>x.id===b.dataset.id);
 switch(b.dataset.do){
 case 'downloadBackup':if(admin)await downloadFileBackup(b);break;
 case 'restoreFileBackup':{
  if(!admin||!backupDraft||backupBusy)return;
  if(!confirm('Να προστεθούν από το backup μόνο οι καταχωρίσεις που λείπουν; Τα υπάρχοντα στοιχεία δεν θα αλλάξουν.'))return;
  backupBusy=true;
  render();
  try{
   const result=await api('backupRestore',{backup:backupDraft});
   if(!result.ok)throw Error('Δεν ολοκληρώθηκε η επαναφορά.');
   const added=Object.values(result.inserted||{}).reduce((sum,n)=>sum+Number(n||0),0);
   backupDraft=null;backupFilename='';
   await refresh();
   bikeLastFetch=0;
   autoSyncBikeCloud().catch(()=>{});
   toast(added>0?'Επανήλθαν '+added+' εγγραφές από το Backup.':'Όλα τα στοιχεία του Backup υπάρχουν ήδη.');
  }catch(e){toast('Αποτυχία επαναφοράς: '+(e?.message||'Άγνωστο σφάλμα'))}
  finally{backupBusy=false;if(route==='backup')render()}
  break;
 }
 case 'refreshTrash':if(admin)await loadTrash();break;
 case 'restoreTrash':{
  if(!admin)return;
  const item=trashItems.find(x=>x.id===b.dataset.id);
  if(!item||!confirm('Να επαναφερθεί η καταχώριση «'+item.label+'»;'))return;
  try{
   await api('trashRestore',{id:item.id});
   await refresh();
   await loadTrash();
   bikeLastFetch=0;
   autoSyncBikeCloud().catch(()=>{});
   toast('Η καταχώριση επανήλθε επιτυχώς.');
  }catch(e){toast('Αδυναμία επαναφοράς: '+(e?.message||'Άγνωστο σφάλμα'))}
  break;
 }
 case 'memberLogout':await memberLogout();break;
 case 'memberRemoveAvatar':
  if(memberAccount&&confirm('Να αφαιρεθεί η φωτογραφία σου;')){
   try{await memberApi('setAvatar',{avatar:null});await refresh();navigate('memberProfile')}
   catch(e){toast(e.message)}
  }
  break;
 case 'adminMemberPassword':
  if(admin){
   const rider=db.riders.find(x=>x.id===b.dataset.id&&x.member);
   if(!rider||memberCredentialIds===null||memberCredentialIds.has(rider.id))return;
   const chosen=prompt('Πρώτος κωδικός για '+rider.name+' (6–64 χαρακτήρες):');
   if(chosen===null)return;
   if(chosen.length<6||chosen.length>64||chosen.trim()!==chosen){toast('Χρειάζονται 6–64 χαρακτήρες χωρίς κενά στην αρχή ή στο τέλος.');return}
   if(!confirm('Να ενεργοποιηθεί ο προσωπικός λογαριασμός του '+rider.name+';'))return;
   try{
    await memberApi('adminSetPassword',{memberId:rider.id,password:chosen});
    memberCredentialIds.add(rider.id);
    toast('Ο πρώτος κωδικός του '+rider.name+' ορίστηκε. Δώσ’ του τον ιδιωτικά.');
   }catch(e){toast(e.message)}
  }
  break;
 case 'adminMemberReset':
  if(!admin||memberCredentialIds===null||!memberCredentialIds.has(b.dataset.id))return;
  {
   const rider=db.riders.find(x=>x.id===b.dataset.id&&x.member);
   if(!rider)return;
   if(!confirm('Να εγκριθεί αλλαγή κωδικού για '+rider.name+' για μία ώρα; Τυχόν προηγούμενος προσωρινός κωδικός θα ακυρωθεί.'))return;
   b.disabled=true;
   try{
    const data=await memberApi('adminIssueReset',{memberId:rider.id});
    adminIssuedRecovery={memberName:data.memberName,code:data.resetCode,expiresAt:data.expiresAt};
    render();
   }catch(err){b.disabled=false;toast(err.message||'Η έγκριση απέτυχε.')}
  }
  break;
 case 'copyMemberReset':
  if(!adminIssuedRecovery||!admin)return;
  try{
   await navigator.clipboard.writeText(adminIssuedRecovery.code);
   toast('Ο προσωρινός κωδικός αντιγράφηκε.');
  }catch{
   prompt('Αντίγραψε τον προσωρινό κωδικό:',adminIssuedRecovery.code);
  }
  break;
 case 'hideMemberReset':
  adminIssuedRecovery=null;render();break;
 case 'checkDatabase':{
  if(!admin||keepaliveBusy)return;
  keepaliveBusy=true;
  b.disabled=true;
  b.setAttribute('aria-busy','true');
  b.textContent='Έλεγχος βάσης...';
  try{
   updateKeepaliveInfo(await keepaliveApi('press'));
   toast('✅ Το Keep Alive ολοκληρώθηκε. Η αντίστροφη μέτρηση 5 ημερών ξεκίνησε ξανά.');
  }catch(e){toast('Αποτυχία Keep Alive: '+(e?.message||'Άγνωστο σφάλμα'))}
  finally{keepaliveBusy=false;b.removeAttribute('aria-busy');if(route==='settings')render()}
  break;
 }
 case 'toggleKeepaliveAlerts':{
  if(!admin)return;
  const push=window.VoltesPush;
  if(!push){toast('Η υπηρεσία Push δεν είναι διαθέσιμη.');return}
  b.disabled=true;
  try{
   if(push.keepaliveAlertsActive()){
    await push.disableKeepaliveAlerts(adminToken);
    toast('Η υπενθύμιση Keep Alive απενεργοποιήθηκε στη συσκευή.');
   }else{
    await push.enableKeepaliveAlerts(adminToken);
    toast('🔔 Η υπενθύμιση Keep Alive ενεργοποιήθηκε σε αυτή τη συσκευή.');
   }
  }catch(e){toast('Ειδοποίηση Keep Alive: '+(e?.message||'Αποτυχία'))}
  finally{b.disabled=false}
  break;
 }
 case 'adminLogout':if(admin){try{await api('logout')}catch{}admin=false;memberCredentialIds=null;adminIssuedRecovery=null;adminToken='';pin='';writeLocal('voltesAdminToken','');await refresh().catch(()=>{});navigate('settings')}break;
 case 'signup':if(memberName()){b.disabled=true;await submitRideSignup(r.id,memberName());}else{window.currentRide=r;navigate('signup')}break;
 case 'olderHistory':historyLimit=10;route='history';render();window.scrollTo(0,0);break;
 case 'moreHistory':historyLimit+=5;render();break;
 case 'cancelSignup':if(!r||!signupTokens[r.id])return;if(confirm('Να ακυρωθεί η συμμετοχή σου;')){b.disabled=true;try{await api('cancelSignup',{id:r.id,cancelToken:signupTokens[r.id]});delete signupTokens[r.id];saveSignupTokens();await refresh()}catch(err){b.disabled=false;toast(err.message)}}break;
 case 'removeAvatar':if(admin&&confirm('Να αφαιρεθεί η φωτογραφία;'))await perform('setAvatar',{id:b.dataset.id,avatar:null},'Η φωτογραφία αφαιρέθηκε.');break;
 case 'editRoute':if(admin){window.currentRouteId=b.dataset.id;navigate('routeEdit')}break;
 case 'useSavedRoute':if(admin){const t=db.routeTemplates.find(x=>x.id===b.dataset.id);if(t){navigate('newDetailed');const select=document.querySelector('#rideTemplateSelect');if(select){select.value=t.id;syncRouteChoice()}}}break;
 case 'finish':if(!admin)return;window.currentRide=r;navigate('finish');break;
 case 'editPlanned':if(!admin||!r||r.done)return;window.currentRide=r;navigate('editPlanned');break;
 case 'editDone':if(!admin||!r?.done)return;window.currentRide=r;navigate('editDone');break;
 case 'delete':if(admin&&r&&confirm('Να διαγραφεί η βόλτα;')){await perform('delete',{id:r.id},'Η βόλτα διαγράφηκε.')}break;
 case 'deleteRider':if(admin){const rider=db.riders.find(x=>x.id===b.dataset.id);if(rider&&confirm('Να διαγραφεί ο ποδηλάτης «'+rider.name+'» από τη λίστα μελών; Οι παλιές βόλτες θα διατηρηθούν.')){await perform('deleteRider',{id:rider.id},'Ο ποδηλάτης διαγράφηκε από τη λίστα.')}}break;
 case 'toggleMember':if(admin){await perform('toggleMember',{id:b.dataset.id},'Ο τύπος μέλους ενημερώθηκε.')}break;
 }
});
app.addEventListener('change',e=>{
 if(e.target.id==='plannedRouteSelect'){const f=e.target.form,t=db.routeTemplates.find(x=>x.id===e.target.value);if(t){f.elements.title.value=t.name;f.elements.routeType.value=t.route_type;f.elements.estimate.value=t.estimate??''}return}
 if(e.target.id==='bikeDetailsAddSelect'){
  const bikeId=e.target.dataset.bikeId,key=e.target.value;
  if(bikeDetailsEditId===bikeId&&bikeDetailFields.some(([field])=>field===key)){
   bikeDetailsFieldKey=key;render();
   document.querySelector('#bikeDetailsValue')?.focus({preventScroll:true});
  }
  return;
 }
 if(e.target.id==='bikeWizardDate'){bikeWizard.date=e.target.value;return}
 if(e.target.id==='quickCustomDate'){quickRideState.date=e.target.value;quickRideState.period='';quickRideState.time='';quickRideState.routeId='';quickRideState.showTimePicker=false;quickRideState.step=quickRideState.date?2:1;render()}
 if(e.target.id==='quickTime')quickRideState.time=e.target.value;
});
app.addEventListener('input',e=>{if(e.target.name==='customPlace'&&e.target.closest('#quickRideForm'))quickRideState.customPlace=e.target.value});
app.addEventListener('focusin',e=>{if(e.target.id==='meetingPlaceInput')updateMeetingPlaceOptions()});
app.addEventListener('input',e=>{if(e.target.id==='meetingPlaceInput')updateMeetingPlaceOptions();if(e.target.closest('#createRide'))updateNewRideForecast()});
app.addEventListener('change',e=>{if(e.target.id==='rideTemplateSelect')syncRouteChoice();else if(e.target.id==='historicalTemplateSelect')syncHistoricalRoute();else if(e.target.id==='editRouteTemplateSelect')syncEditRouteChoice();else if(e.target.closest('#createRide'))updateNewRideForecast()});
function updateNewRideForecast(){
 const f=document.querySelector('#createRide'),out=document.querySelector('#newRideForecast');if(!f||!out)return;
 const distance=Number(f.elements.namedItem('estimate').value),kind=f.elements.namedItem('routeType').value;
 const speed={flat:20,mixed:12,mountain:9}[kind]||20;
 out.textContent=distance>0&&distance<=1000?'Αρχική εκτίμηση: '+formatMovingTime(Math.ceil(distance/speed*60)+10)+' (ταχύτητα '+speed+' km/h, μαζί με 10 λεπτά). Οι Admin θα βλέπουν αργότερα και πρόβλεψη από το ιστορικό.':'Πρόσθεσε εκτιμώμενα χιλιόμετρα για υπολογισμό διάρκειας.';
}
app.addEventListener('input',e=>{
 const el=e.target;
 if(!(el instanceof HTMLInputElement)||el.name!=='pin'||el.closest('form')?.id!=='login')return;
 const form=el.form;
 if(!form||form.dataset.submitting==='1')return;
 if(/^\d{4}$/.test(el.value)){
  form.dataset.submitting='1';
  form.requestSubmit();
 }
});
app.addEventListener('submit',async e=>{
 e.preventDefault();let f=e.target,d=new FormData(f);
 const values=Object.fromEntries(d.entries());
 if(f.id==='memberRegisterForm'||f.id==='memberLoginForm'){
  const name=String(values.name||'').trim(),password=String(values.password||'');
  if(name.length<2||name.length>70||password.length<6||password.length>64){toast('Συμπλήρωσε όνομα και κωδικό 6–64 χαρακτήρων.');return}
  if(f.id==='memberRegisterForm'&&password!==String(values.confirmPassword||'')){toast('Οι κωδικοί δεν ταιριάζουν.');return}
  const button=f.querySelector('button[type="submit"]');if(button)button.disabled=true;
  try{
   const result=await memberApi(f.id==='memberRegisterForm'?'register':'login',{name,password});
   memberSignedIn(result);await refresh();navigate('memberProfile');autoSyncBikeCloud().catch(()=>{});
  }catch(err){if(button)button.disabled=false;toast(err.message||'Η σύνδεση απέτυχε.')}
  return;
 }
 if(f.id==='memberRecoveryForm'){
  const name=String(values.name||'').trim();
  const resetCode=String(values.resetCode||'').trim();
  const newPassword=String(values.newPassword||'');
  if(newPassword!==String(values.confirmPassword||'')){toast('Οι νέοι κωδικοί δεν ταιριάζουν.');return}
  if(name.length<2||!resetCode||newPassword.length<6||newPassword.length>64){toast('Έλεγξε τα στοιχεία επαναφοράς και τον νέο κωδικό.');return}
  const button=f.querySelector('button[type="submit"]');if(button)button.disabled=true;
  try{
   const result=await memberApi('resetPassword',{name,resetCode,newPassword});
   memberSignedIn(result);
   await refresh();
   navigate('memberProfile');
   autoSyncBikeCloud().catch(()=>{});
   toast('Ο κωδικός σου άλλαξε. Ο προσωρινός κωδικός δεν ισχύει πλέον.');
  }catch(err){if(button)button.disabled=false;toast(err.message||'Η επαναφορά απέτυχε.')}
  return;
 }
 if(f.id==='memberPasswordForm'){
  const currentPassword=String(values.currentPassword||'');
  const newPassword=String(values.newPassword||'');
  if(newPassword!==String(values.confirmPassword||'')){toast('Οι νέοι κωδικοί δεν ταιριάζουν.');return}
  if(newPassword.length<6||newPassword.length>64){toast('Ο νέος κωδικός πρέπει να είναι 6–64 χαρακτήρες.');return}
  const button=f.querySelector('button[type="submit"]');if(button)button.disabled=true;
  try{memberSignedIn(await memberApi('changePassword',{currentPassword,newPassword}));navigate('memberProfile');toast('Ο προσωπικός κωδικός άλλαξε.')}
  catch(err){if(button)button.disabled=false;toast(err.message||'Η αλλαγή απέτυχε.')}
  return;
 }
 if(f.id==='bikeDetailsFieldForm'){
  const bikeId=f.dataset.bikeId,field=f.dataset.field;
  const bike=ownBikes().find(x=>x.id===bikeId);
  if(!bike||bikeDetailsEditId!==bikeId||bikeDetailsFieldKey!==field)return;
  const pressure=field==='frontBar'||field==='rearBar';
  if(!pressure&&!bikeDetailFields.some(([key])=>key===field))return;
  const raw=String(values.value??'').trim();
  const details={...(bike.bike_details&&typeof bike.bike_details==='object'?bike.bike_details:{})};
  if(pressure){
   if(raw){
    const value=Number(raw.replace(',','.'));
    if(!Number.isFinite(value)||value<0.5||value>10||Math.abs(value*10-Math.round(value*10))>1e-8){
     toast('Επίλεξε πίεση 0,5–10 bar με ένα δεκαδικό.');return;
    }
    details[field]=value;
   }else delete details[field];
  }else{
   if(raw.length>160){toast('Μέγιστο 160 χαρακτήρες.');return}
   if(raw)details[field]=raw;
   else delete details[field];
  }
  const button=f.querySelector('button[type="submit"]');if(button)button.disabled=true;
  const okay=await bikeAction('saveBikeDetails',{bikeId,details},'Αποθηκεύτηκε.');
  if(okay){bikeDetailsFieldKey='';render()}else if(button)button.disabled=false;
  return;
 }
 if(f.id==='bikeRenameForm'){
  const name=String(values.name||'').trim();
  if(name.length<2||name.length>90){toast('Γράψε το μοντέλο του ποδηλάτου σου.');return}
  await bikeAction('createBike',{name},'Το ποδήλατο ονομάστηκε.');return;
 }
 if(f.id==='bikeOdometerForm'){
  const km=Number(values.km);
  if(!Number.isFinite(km)||km<0||km>1000000){toast('Έλεγξε τα συνολικά χιλιόμετρα.');return}
  await bikeAction('setOdometer',{bikeId:f.dataset.bikeId,km},'Τα χιλιόμετρα ενημερώθηκαν.');return;
 }
 if(f.id==='bikeMaintenanceForm'){
  const info={bikeId:f.dataset.bikeId,...(f.dataset.id?{id:f.dataset.id}:{}),label:String(values.label||'').trim(),
    intervalKm:String(values.intervalKm||''),intervalDays:String(values.intervalDays||''),lastKm:String(values.lastKm||''),
    lastDate:String(values.lastDate||''),notes:String(values.notes||'').trim()};
  if(!info.intervalKm&&!info.intervalDays){toast('Συμπλήρωσε διάστημα χιλιομέτρων ή ημερών.');return}
  const okay=await bikeAction('saveMaintenance',info,'Η προγραμματισμένη εργασία αποθηκεύτηκε.');
  if(okay){maintenanceEditId='';render()}return;
 }
 if(f.id==='bikeServiceForm'){
  const q=bikeWizard,bike=q.bike,date=q.date,work=q.work,notes=String(values.notes||'').trim(),km=String(values.km||'').trim();
  const dateValue=new Date(date+'T12:00:00Z');
  if(q.step!==4||!registeredBikes().includes(bike)||notes.length>600||(!serviceWorks.includes(work)&&!(q.editId&&bikeCloud.services.some(s=>s.id===q.editId&&s.work===work)))||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(dateValue.getTime())||dateValue.toISOString().slice(0,10)!==date||date>greekDay()||(km!==''&&(!/^\d+$/.test(km)||Number(km)>1000000))){toast('Έλεγξε τα στοιχεία του σέρβις.');return}
  const selected=bikeByName(bike);if(!selected){toast('Το ποδήλατο δεν βρέθηκε.');return}
  const editId=q.editId;
  const okay=await bikeAction(editId?'updateService':'addService',{bikeId:selected.id,...(editId?{id:editId}:{}),date,work,notes,km},editId?'Το σέρβις διορθώθηκε.':'Το σέρβις αποθηκεύτηκε.');
  if(okay)resetBikeWizard();return;
 }
 if(f.id==='quickRideForm'&&admin){
  const q=quickRideState,date=quickDate(),chosen=db.routeTemplates.find(x=>x.id===q.routeId);
  const departure=String(values.departureTime||q.time||'');
  const place=q.placeMode==='mavili'?'Πλατεία Μαβίλη':String(values.customPlace||q.customPlace||'').trim();
  if(!date||date<greekDay()||!chosen||!['morning','noon','afternoon'].includes(q.period)||!place){toast('Συμπλήρωσε ημέρα, μέρος ημέρας, διαδρομή και σημείο συνάντησης.');return}
  if(departure&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(departure)){toast('Μη έγκυρη ώρα.');return}
  const duplicate=db.rides.some(r=>!r.done&&r.date===date&&r.routeTemplateId===chosen.id);
  if(duplicate&&!confirm('Υπάρχει ήδη προγραμματισμένη βόλτα με αυτή τη διαδρομή την ίδια ημέρα. Να δημοσιευτεί άλλη;'))return;
  const button=f.querySelector('button[type="submit"]');button.disabled=true;
  if(await perform('create',{date,time:departure,timePeriod:q.period,routeTemplateId:chosen.id,place,title:chosen.name,routeType:chosen.route_type,estimate:chosen.estimate??''},'Η βόλτα δημοσιεύτηκε.'))navigate('upcoming');else button.disabled=false;
 }else if(f.id==='login'){
  const attempted=String(d.get('pin')||'');
  pin=attempted;
  try{const result=await api('login');adminToken=result.adminToken;pin='';if(!adminToken)throw Error('Απαιτείται ενημέρωση της υπηρεσίας.');if(!writeLocal('voltesAdminToken',adminToken))message='Η σύνδεση ισχύει για τώρα, αλλά ο browser δεν επιτρέπει να αποθηκευτεί.';await refresh();navigate(embeddedAdminRoute||'settings')}
  catch(err){pin='';adminToken='';writeLocal('voltesAdminToken','');toast(err.message);const input=app.querySelector('#login input[name="pin"]');if(input){input.value='';input.form.dataset.submitting='0';input.focus()}}
 }else if(f.id==='saveRouteForm'&&admin){
  const points=String(values.points||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(await perform('saveRoute',{name:values.name,points,routeType:values.routeType,estimate:values.estimate},'Η διαδρομή αποθηκεύτηκε.'))navigate('routes');
 }else if(f.id==='editRouteForm'&&admin){
  const points=String(values.points||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(points.length<2||points.length>6){toast('Συμπλήρωσε 2–6 σημεία.');return}
  const button=f.querySelector('button[type="submit"]');button.disabled=true;
  if(await perform('editRoute',{id:f.dataset.id,name:values.name,points,routeType:values.routeType,estimate:values.estimate},'Η διαδρομή ενημερώθηκε.'))navigate('routes');else button.disabled=false;
 }else if(f.id==='createRide'&&admin){
  if(await perform('create',values,'Η βόλτα δημοσιεύτηκε.'))navigate('upcoming');
 }else if(f.id==='addRider'&&admin){
  await perform('addRider',{name:values.name,member:values.riderType==='member'},'Ο ποδηλάτης προστέθηκε.');
 }else if(f.id==='signupForm'){
  const button=f.querySelector('button');button.disabled=true;
  await submitRideSignup(f.dataset.id,String(values.name||'').trim());
 }else if(f.id==='editPlannedForm'&&admin){
  if(f.dataset.saving)return;const fields=Object.fromEntries(new FormData(f));if(!fields.time&&!fields.timePeriod){toast('Όρισε ώρα ή μέρος της ημέρας.');return}
  f.dataset.saving='1';const submit=f.querySelector('button[type="submit"]');if(submit)submit.disabled=true;
  const keepRoute=fields.routeTemplateId==='keep';if(keepRoute)fields.routeTemplateId='';
  try{await api('editPlannedRide',{...fields,id:f.dataset.id,keepRoute});await refresh();navigate('home');toast('Η βόλτα ενημερώθηκε.')}catch(err){const note=document.createElement('p');note.className='alert';note.textContent=err.message;f.append(note)}finally{delete f.dataset.saving;if(submit)submit.disabled=false}
 }else if(f.id==='editCompletedForm'&&admin){
  const points=String(values.points||'').split(',').map(x=>x.trim()).filter(Boolean);
  const attendees=d.getAll('person').map(x=>String(x).trim());
  const title=String(values.title||'').trim();
  if(title.length<2||title.length>100||!(points.length===0||(points.length>=2&&points.length<=6))||points.some(x=>x.length<2||x.length>80)||!attendees.length){
   const notice=document.createElement('p');notice.className='alert validationError';notice.textContent='Συμπλήρωσε τίτλο, τουλάχιστον έναν συμμετέχοντα και είτε 2–6 σημεία είτε κανένα.';f.querySelector('.validationError')?.remove();f.prepend(notice);return;
  }
  const button=f.querySelector('button[type="submit"]');button.disabled=true;
  try{
   await api('editCompletedRide',{id:f.dataset.id,title,attendees,points,routeType:values.routeType,routeTemplateId:values.routeTemplateId});
   await refresh();navigate('history');
  }catch(err){
   button.disabled=false;
   const notice=document.createElement('p');notice.className='alert validationError';notice.setAttribute('role','alert');notice.textContent=err.message;f.querySelector('.validationError')?.remove();f.prepend(notice);
  }
 }else if(f.id==='historicalForm'&&admin){
  let completion;
  try{completion=validateCompletion({...values,attendees:d.getAll('person'),slowed:d.getAll('slowed')});if(!values.date)throw Error('Συμπλήρωσε την ημερομηνία της βόλτας.')}
  catch(err){let notice=document.createElement('p');notice.className='alert validationError';notice.textContent=err.message;f.querySelector('.validationError')?.remove();f.prepend(notice);return}
  const button=f.querySelector('button[type=submit],button:not([type])');button.disabled=true;
  try{await api('addHistoricalRide',{...completion,date:values.date,time:values.time,title:values.title,routeTemplateId:values.routeTemplateId});await refresh();navigate('history')}
  catch(err){button.disabled=false;let notice=document.createElement('p');notice.className='alert validationError';notice.textContent=err.message;f.querySelector('.validationError')?.remove();f.prepend(notice)}
 }else if(f.id==='finishForm'&&admin){
  if(!completionV2){toast('Απαιτείται ενημέρωση του backend.');return}
  let completion;
  try{completion=validateCompletion({...values,attendees:d.getAll('person'),slowed:d.getAll('slowed')})}
  catch(err){let notice=document.createElement('p');notice.className='alert';notice.setAttribute('role','alert');notice.textContent=err.message;f.querySelector('.validationError')?.remove();notice.classList.add('validationError');f.prepend(notice);return}
  const button=f.querySelector('button[type=submit],button:not([type])');button.disabled=true;
  try{await api('finish',{id:f.dataset.id,...completion});await refresh();navigate('history')}
  catch(err){button.disabled=false;let notice=document.createElement('p');notice.className='alert';notice.setAttribute('role','alert');notice.textContent=err.message;f.prepend(notice)}
 }
});
start();
if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('sw.js').catch(()=>{});
// Re-publish v42: retain all existing features and completed-ride editor.
