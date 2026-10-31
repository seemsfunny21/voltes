'use strict';
// Shared state and admin authorization are provided by the Supabase API.
const {formatMovingTime,validateCompletion}=globalThis.VoltesCompletion;
const API_URL = (window.VOLTES_API_URL || '').trim();
const safe=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
let db={rides:[],riders:[],members:0};
let completionV2=false;
let admin=false,pin=sessionStorage.getItem('voltesAdminPin')||'',route='home',message='';
const app=document.querySelector('#app'),nav=document.querySelector('#nav');
async function api(action,fields={}){
 if(!API_URL)throw Error('Χρειάζεται σύνδεση με το Supabase (config.js).');
 const response=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...fields,pin:pin||undefined})});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Σφάλμα επικοινωνίας');return data;
}
async function refresh(){const result=await api('state');db={rides:result.rides||[],riders:result.riders||[],members:result.members||0};admin=!!result.admin;completionV2=result.capabilities?.rideCompletionV2===true;render()}
async function perform(action,fields,success){try{await api(action,fields);await refresh();if(success)toast(success);return true}catch(e){toast(e.message);return false}}
async function start(){
 if(!API_URL){app.innerHTML='<p class="alert">Η εφαρμογή χρειάζεται ρύθμιση του Supabase. Συμπλήρωσε το API_URL στο config.js σύμφωνα με το README.</p>';return}
 try{await refresh()}catch(e){app.innerHTML=`<p class="alert">${safe(e.message)}</p>`}
}
const datefmt=d=>new Date(d+'T12:00:00').toLocaleDateString('el-GR',{day:'2-digit',month:'2-digit',year:'numeric'});
function toast(v){message=v;render()}
function navigate(v){route=v;nav.classList.add('hidden');document.querySelector('#menuBtn').setAttribute('aria-expanded','false');render();window.scrollTo(0,0)}
function renderNotice(){return message?`<p class="alert" role="status">${safe(message)}</p>`:''}
function stats(){let completed=db.rides.filter(x=>x.done);return `<section class="metrics"><div class="metric"><b>${completed.length}</b><small>Βόλτες</small></div><div class="metric"><b>${Math.round(completed.reduce((a,x)=>a+Number(x.km||0),0))}</b><small>Χιλιόμετρα</small></div><div class="metric"><b>${(admin?db.riders.filter(x=>x.member).length:db.members)}</b><small>Μέλη</small></div></section>`}
function active(){return db.rides.filter(r=>!r.done).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))}
function completed(){return db.rides.filter(r=>r.done).sort((a,b)=>(b.date+(b.time||'')).localeCompare(a.date+(a.time||'')))}
function rideCard(r){let n=r.done?(r.attendeeCount??(r.attendees||[]).length):(r.signupCount??(r.signups||[]).length);return `<article class="card"><div class="row"><strong>${safe(r.title||'Ποδηλατική βόλτα')}</strong><span class="pill">${r.done?'Ολοκληρώθηκε':'Προγραμματισμένη'}</span></div><p class="muted">📅 ${datefmt(r.date)} ${safe(r.time||'')} ${r.place?' · 📍 '+safe(r.place):''}</p><div class="row"><span>🚴 ${r.done?safe(r.km)+' km':(r.estimate?safe(r.estimate)+' km (εκτίμηση)':'Απόσταση υπό καθορισμό')}</span><span>👥 ${n} ${r.done?'συμμετέχοντες':'δηλώσεις'}</span></div>${r.done?`<p class="muted">Υψομετρική ανάβαση: ${r.elevationGain==null?'—':safe(r.elevationGain)+' m'} · Χρόνος κίνησης: ${r.movingMinutes==null?'—':safe(formatMovingTime(r.movingMinutes))}</p>`:''}${admin&&r.done?`<p>Μέση ταχύτητα: <b>${safe(r.speed)} km/h</b></p><p class="muted">Συμμετείχαν: ${(r.attendees||[]).map(safe).join(', ')||'—'}</p>${r.slowdownNotes?`<p class="note">Ιδιωτική παρατήρηση Admin: ${safe(r.slowdownNotes)}</p>`:''}${r.slowed?.length?`<p class="note">Παρατήρηση ρυθμού: ${r.slowed.map(safe).join(', ')}</p>`:''}`:''}${admin&&!r.done?`<p class="note">Δηλώσεις: ${(r.signups||[]).map(x=>safe(x.name)).join(', ')||'Καμία'}</p>`:''}<div class="actions">${!r.done?`<button class="btn secondary" data-do="signup" data-id="${r.id}">Δήλωση συμμετοχής</button>${admin?`<button class="btn" data-do="finish" data-id="${r.id}">Ολοκλήρωση</button>`:''}`:''}${admin?`<button class="btn danger" data-do="delete" data-id="${r.id}">Διαγραφή</button>`:''}</div></article>`}
function home(){let next=active(),past=completed().slice(0,5);return `<h1>Αρχική</h1>${admin?'<div class="actions"><button class="btn" data-go="new">+ Νέα βόλτα</button></div>':''}${stats()}<h2>Προγραμματισμένες βόλτες</h2>${next.length?next.map(rideCard).join(''):'<p class="empty">Δεν υπάρχουν προγραμματισμένες βόλτες.</p>'}<h2>Ιστορικό · 5 τελευταίες διαδρομές</h2>${past.length?past.map(rideCard).join(''):'<p class="empty">Δεν έχουν καταγραφεί διαδρομές ακόμη.</p>'}`}
function upcoming(){return `<h1>Προγραμματισμένες βόλτες</h1>${admin?'<button class="btn" data-go="new">+ Νέα βόλτα</button>':''}${active().length?active().map(rideCard).join(''):'<p class="empty">Καμία προγραμματισμένη βόλτα.</p>'}`}
function history(){return `<h1>Ιστορικό διαδρομών</h1>${completed().length?completed().slice(0,5).map(rideCard).join(''):'<p class="empty">Καμία ολοκληρωμένη διαδρομή.</p>'}`}
function newRide(){return `<h1>+ Νέα βόλτα</h1><div class="card"><form id="createRide"><label>Ημερομηνία <input required type="date" name="date" min="2020-01-01" value="${today()}"></label><label>Ώρα <input required type="time" name="time" value="09:00"></label><label>Σημείο συνάντησης <input required maxlength="120" name="place" placeholder="π.χ. Πλατεία Μαβίλη"></label><label>Τίτλος (προαιρετικά) <input maxlength="100" name="title" placeholder="π.χ. Γύρος λίμνης"></label><label>Εκτιμώμενα χιλιόμετρα (προαιρετικά) <input type="number" min="1" max="1000" step="0.1" name="estimate"></label><button class="btn">Δημοσίευση βόλτας</button></form></div>`}
function signup(r){return `<h1>Δήλωση συμμετοχής</h1><div class="card"><h2>${safe(r.title||'Ποδηλατική βόλτα')}</h2><p class="muted">${datefmt(r.date)} · ${safe(r.time)} · ${safe(r.place)}</p><form id="signupForm" data-id="${r.id}"><label>Το όνομά σου <input required maxlength="70" name="name" autocomplete="name" placeholder="Όνομα και επώνυμο"></label><button class="btn">Θα συμμετέχω</button></form><p class="note">Το όνομα θα είναι ορατό μόνο στους Admin. Η δήλωση αποθηκεύεται στην κοινή βάση της ομάδας.</p></div>`}
function finish(r){let names=[...new Set([...(r.signups||[]).map(x=>x.name),...db.riders.map(x=>x.name)])];return `<h1>Ολοκλήρωση βόλτας</h1><div class="card"><h2>${safe(r.title||'Ποδηλατική βόλτα')}</h2><form id="finishForm" data-id="${r.id}"><label>Πραγματική απόσταση (km) <input required name="km" type="number" min="0.1" max="1000" step="0.01"></label><label>Κοινή μέση ταχύτητα (km/h) <input required name="speed" type="number" min="1" max="100" step="0.1"></label><label>Υψομετρική ανάβαση (m) <input required name="elevationGain" type="number" min="0" max="50000" step="1" inputmode="numeric"></label><label>Χρόνος κίνησης (ώρες:λεπτά) <input required name="movingTime" type="text" inputmode="text" pattern="[0-9]{1,3}:[0-5][0-9]" placeholder="1:40" maxlength="6" aria-describedby="movingTimeHelp"></label><p id="movingTimeHelp" class="note">Μόνο ο χρόνος κίνησης από το Strava, χωρίς στάσεις (π.χ. 1:40).</p><label>Σύνδεσμος Strava (προαιρετικά) <input name="strava" type="url" placeholder="https://www.strava.com/activities/..."></label><p>Πραγματικοί συμμετέχοντες — επιλέξτε όσους ήρθαν</p>${names.length?names.map((n,i)=>`<label class="check"><input type="checkbox" name="person" value="${safe(n)}" ${(r.signups||[]).some(s=>s.name===n)?'checked':''}>${safe(n)}</label>`).join(''):'<p class="note">Δεν υπάρχουν ακόμη συμμετέχοντες. Πρόσθεσέ τους πρώτα από το μητρώο ποδηλατών.</p>'}<label>Ποιος δυσκολεύτηκε να ακολουθήσει; (προαιρετικά, μόνο Admin)</label>${names.map(n=>`<label class="check"><input type="checkbox" name="slowed" value="${safe(n)}">${safe(n)}</label>`).join('')}<label>Ιδιωτική παρατήρηση Admin (προαιρετικά)<textarea name="slowdownNotes" maxlength="2000" rows="3" placeholder="Σημείωση για τον ρυθμό των επιλεγμένων συμμετεχόντων"></textarea></label>${!completionV2?'<p class="alert">Απαιτείται ενημέρωση του backend πριν αποθηκευτούν τα νέα στοιχεία. Η βόλτα δεν έχει αλλάξει.</p>':''}<button class="btn" ${!completionV2?'disabled':''}>Αποθήκευση στο ιστορικό</button></form></div>`}
function riders(){let r=db.riders;return `<h1>Ποδηλάτες & επισκέπτες</h1><div class="card"><form id="addRider"><label>Όνομα <input name="name" required maxlength="70" placeholder="Όνομα και επώνυμο"></label><label class="check"><input type="checkbox" name="member" checked>Μόνιμο μέλος</label><button class="btn">Προσθήκη ποδηλάτη</button></form></div><div class="card">${r.length?r.map(x=>`<div class="item row"><span>${safe(x.name)} <small class="muted">(${x.member?'Μέλος':'Επισκέπτης'})</small></span><button class="btn secondary" data-do="toggleMember" data-id="${x.id}">Αλλαγή τύπου</button></div>`).join(''):'<p class="muted">Δεν υπάρχουν καταχωρισμένοι ποδηλάτες.</p>'}</div>`}
function analytics(){let list=db.riders.map(p=>{let rides=completed().filter(r=>(r.attendees||[]).includes(p.name));let total=rides.reduce((s,r)=>s+Number(r.km),0);return {name:p.name,count:rides.length,km:total,elevation:rides.some(r=>r.elevationGain!=null)?rides.reduce((s,r)=>s+Number(r.elevationGain||0),0):null,moving:rides.some(r=>r.movingMinutes!=null)?rides.reduce((s,r)=>s+Number(r.movingMinutes||0),0):null,mean:rides.length?rides.reduce((s,r)=>s+Number(r.speed),0)/rides.length:0}}).sort((a,b)=>b.km-a.km);return `<h1>Στατιστικά ποδηλατών</h1><p class="alert">Ο κοινός μέσος όρος των διαδρομών δεν αποτελεί μέτρηση ατομικής ταχύτητας. Δεν παράγεται ακόμη αυτόματη κατάταξη.</p>${list.length?list.map(p=>`<article class="card"><div class="row"><strong>${safe(p.name)}</strong><span>${p.count} βόλτες</span></div><p>${p.km.toFixed(1)} km · Μ.Ο. ομάδων ${p.count?p.mean.toFixed(1)+' km/h':'—'}</p><p class="muted">Καταγεγραμμένη ανάβαση: ${p.elevation==null?'—':safe(p.elevation)+' m'} · Χρόνος κίνησης: ${p.moving==null?'—':safe(formatMovingTime(p.moving))}</p></article>`).join(''):'<p class="empty">Πρόσθεσε μέλη και ολοκληρωμένες βόλτες για να εμφανιστούν στατιστικά.</p>'}`}
function auth(){return `<h1>Είσοδος Admin</h1><div class="card"><p class="alert">Το PIN ελέγχεται από την υπηρεσία. Για μικρή ιδιωτική ομάδα μόνο.</p><form id="login"><label>PIN δοκιμής <input type="password" name="pin" required inputmode="numeric" maxlength="4" minlength="4" pattern="[0-9]{4}" placeholder="••••"></label><button class="btn">Είσοδος</button></form><p class="note">Το PIN ορίζεται στα μυστικά του Supabase.</p></div>`}
function render(){if(!admin&&['new','riders','stats','finish'].includes(route))route='home';document.querySelector('#adminNav').classList.toggle('hidden',!admin);document.querySelector('#authBtn').textContent=admin?'Αποσύνδεση Admin':'Είσοδος Admin';let html=route==='home'?home():route==='upcoming'?upcoming():route==='history'?history():route==='new'?newRide():route==='riders'?riders():route==='stats'?analytics():route==='auth'?auth():route==='signup'&&window.currentRide?signup(window.currentRide):route==='finish'&&window.currentRide&&admin?finish(window.currentRide):home();app.innerHTML=renderNotice()+html;message=''}
document.querySelector('#menuBtn').onclick=()=>{nav.classList.toggle('hidden');document.querySelector('#menuBtn').setAttribute('aria-expanded',String(!nav.classList.contains('hidden')))};
nav.addEventListener('click',e=>{let b=e.target.closest('button');if(!b)return;if(b.dataset.route)navigate(b.dataset.route);else if(b.id==='authBtn'){if(admin){admin=false;pin='';sessionStorage.removeItem('voltesAdminPin');refresh().then(()=>navigate('home'))}else navigate('auth')}});
app.addEventListener('click',async e=>{
 let b=e.target.closest('button');if(!b)return;
 if(b.dataset.go){navigate(b.dataset.go);return}
 if(!b.dataset.do)return;
 let r=db.rides.find(x=>x.id===b.dataset.id);
 switch(b.dataset.do){
 case 'signup':window.currentRide=r;navigate('signup');break;
 case 'finish':if(!admin)return;window.currentRide=r;navigate('finish');break;
 case 'delete':if(admin&&r&&confirm('Να διαγραφεί η βόλτα;')){await perform('delete',{id:r.id},'Η βόλτα διαγράφηκε.')}break;
 case 'toggleMember':if(admin){await perform('toggleMember',{id:b.dataset.id},'Ο τύπος μέλους ενημερώθηκε.')}break;
 }
});
app.addEventListener('submit',async e=>{
 e.preventDefault();let f=e.target,d=new FormData(f);
 const values=Object.fromEntries(d.entries());
 if(f.id==='login'){
  const attempted=String(d.get('pin')||'');
  pin=attempted;
  try{await api('login');sessionStorage.setItem('voltesAdminPin',pin);await refresh();navigate('home')}
  catch(err){pin='';sessionStorage.removeItem('voltesAdminPin');toast(err.message)}
 }else if(f.id==='createRide'&&admin){
  if(await perform('create',values,'Η βόλτα δημοσιεύτηκε.'))navigate('upcoming');
 }else if(f.id==='addRider'&&admin){
  await perform('addRider',{name:values.name,member:d.has('member')},'Ο ποδηλάτης προστέθηκε.');
 }else if(f.id==='signupForm'){
  if(await perform('signup',{id:f.dataset.id,name:values.name},'Η δήλωση συμμετοχής καταχωρίστηκε.'))navigate('upcoming');
 }else if(f.id==='finishForm'&&admin){
  if(!completionV2){toast('Απαιτείται ενημέρωση του backend.');return}
  let completion;
  try{completion=validateCompletion({...values,attendees:d.getAll('person'),slowed:d.getAll('slowed')})}
  catch(err){let notice=document.createElement('p');notice.className='alert';notice.setAttribute('role','alert');notice.textContent=err.message;f.querySelector('.validationError')?.remove();notice.classList.add('validationError');f.prepend(notice);return}
  const button=f.querySelector('button[type=submit],button:not([type])');button.disabled=true;
  try{await api('finish',{id:f.dataset.id,...completion});await refresh();navigate('history');toast('Η διαδρομή ολοκληρώθηκε.')}
  catch(err){button.disabled=false;let notice=document.createElement('p');notice.className='alert';notice.setAttribute('role','alert');notice.textContent=err.message;f.prepend(notice)}
 }
});
start();
if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('sw.js').catch(()=>{});
