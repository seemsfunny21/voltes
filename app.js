'use strict';
// Shared state and admin authorization are provided by the Supabase API.
const {formatMovingTime,validateCompletion}=globalThis.VoltesCompletion;
const API_URL = (window.VOLTES_API_URL || '').trim();
const safe=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
let db={rides:[],riders:[],members:0};
let completionV2=false;
const readLocal=(key,fallback='')=>{try{return localStorage.getItem(key)||fallback}catch{return fallback}};
const writeLocal=(key,value)=>{try{value?localStorage.setItem(key,value):localStorage.removeItem(key);return true}catch{return false}};
let admin=false,pin='',adminToken=readLocal('voltesAdminToken'),route='home',message='',historyLimit=5;
let signupTokens;try{signupTokens=JSON.parse(readLocal('voltesSignupTokens','{}'));if(!signupTokens||typeof signupTokens!=='object'||Array.isArray(signupTokens))signupTokens={}}catch{signupTokens={}}
sessionStorage.removeItem('voltesAdminPin');
function newToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}
function saveSignupTokens(){return writeLocal('voltesSignupTokens',JSON.stringify(signupTokens))}
const app=document.querySelector('#app'),nav=document.querySelector('#nav');
async function api(action,fields={}){
 if(!API_URL)throw Error('Χρειάζεται σύνδεση με το Supabase (config.js).');
 const response=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...fields,pin:pin||undefined,adminToken:adminToken||undefined,...(action==='state'?{signupTokens}: {})})});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Σφάλμα επικοινωνίας');return data;
}
async function refresh(){const result=await api('state');db={rides:result.rides||[],riders:result.riders||[],members:result.members||0};admin=!!result.admin;if(!admin&&adminToken){adminToken='';writeLocal('voltesAdminToken','')}completionV2=result.capabilities?.rideCompletionV2===true;render()}
async function perform(action,fields,success){try{await api(action,fields);await refresh();if(success)toast(success);return true}catch(e){toast(e.message);return false}}
async function start(){
 if(!API_URL){app.innerHTML='<p class="alert">Η εφαρμογή χρειάζεται ρύθμιση του Supabase. Συμπλήρωσε το API_URL στο config.js σύμφωνα με το README.</p>';return}
 try{await refresh()}catch(e){app.innerHTML=`<p class="alert">${safe(e.message)}</p>`}
}
const datefmt=d=>new Date(d+'T12:00:00').toLocaleDateString('el-GR',{day:'2-digit',month:'2-digit',year:'numeric'});
function toast(v){message=v;render()}
function navigate(v){route=v;if(v==='history')historyLimit=5;nav.classList.add('hidden');document.querySelector('#menuBtn').setAttribute('aria-expanded','false');render();window.scrollTo(0,0)}
function renderNotice(){return message?`<p class="alert" role="status">${safe(message)}</p>`:''}
function stats(){let completed=db.rides.filter(x=>x.done);return `<section class="metrics"><div class="metric"><b>${completed.length}</b><small>Βόλτες</small></div><div class="metric"><b>${Math.round(completed.reduce((a,x)=>a+Number(x.km||0),0))}</b><small>Χιλιόμετρα</small></div><div class="metric"><b>${(admin?db.riders.filter(x=>x.member).length:db.members)}</b><small>Μέλη</small></div></section>`}
function active(){return db.rides.filter(r=>!r.done).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))}
function completed(){return db.rides.filter(r=>r.done).sort((a,b)=>(b.date+(b.time||'')).localeCompare(a.date+(a.time||'')))}
function rideCard(r){let n=r.done?(r.attendeeCount??(r.attendees||[]).length):(r.signupCount??(r.signups||[]).length);return `<article class="card ride-card"><div class="row"><strong>${safe(r.title||'Ποδηλατική βόλτα')}</strong><span class="pill">${r.done?'Ολοκληρώθηκε':'Προγραμματισμένη'}</span></div><p class="muted">📅 ${datefmt(r.date)} ${safe(r.time||'')} ${r.place?' · 📍 '+safe(r.place):''}</p><div class="row"><span>🚴 ${r.done?safe(r.km)+' km':(r.estimate?safe(r.estimate)+' km (εκτίμηση)':'Απόσταση υπό καθορισμό')}</span><span>👥 ${n} ${r.done?'συμμετέχοντες':'δηλώσεις'}</span></div>${r.done?`<p class="muted">Υψομετρική ανάβαση: ${r.elevationGain==null?'—':safe(r.elevationGain)+' m'} · Χρόνος κίνησης: ${r.movingMinutes==null?'—':safe(formatMovingTime(r.movingMinutes))}</p>`:''}${admin&&r.done?`<p>Μέση ταχύτητα: <b>${safe(r.speed)} km/h</b></p><p class="muted">Συμμετείχαν: ${(r.attendees||[]).map(safe).join(', ')||'—'}</p>${r.slowdownNotes?`<p class="note">Ιδιωτική παρατήρηση Admin: ${safe(r.slowdownNotes)}</p>`:''}${r.slowed?.length?`<p class="note">Παρατήρηση ρυθμού: ${r.slowed.map(safe).join(', ')}</p>`:''}`:''}${admin&&!r.done?`<p class="note">Δηλώσεις: ${(r.signups||[]).map(x=>safe(x.name)).join(', ')||'Καμία'}</p>`:''}<div class="actions">${!r.done?`<button class="btn secondary" data-do="${r.mySignup?'cancelSignup':'signup'}" data-id="${r.id}">${r.mySignup?'Ακύρωση συμμετοχής':'Δήλωση συμμετοχής'}</button>${admin?`<button class="btn" data-do="finish" data-id="${r.id}">Ολοκλήρωση</button>`:''}`:''}${admin?`<button class="btn danger" data-do="delete" data-id="${r.id}">Διαγραφή</button>`:''}</div></article>`}
function home(){let next=active(),past=completed().slice(0,5);return `<h1>Αρχική</h1>${admin?'<div class="actions"><button class="btn" data-go="new">+ Νέα βόλτα</button></div>':''}${stats()}<h2>Προγραμματισμένες βόλτες</h2>${next.length?next.map(rideCard).join(''):'<p class="empty">Δεν υπάρχουν προγραμματισμένες βόλτες.</p>'}<h2>Ιστορικό · 5 τελευταίες διαδρομές</h2>${past.length?past.map(rideCard).join(''):'<p class="empty">Δεν έχουν καταγραφεί διαδρομές ακόμη.</p>'}${completed().length>5?'<div class="actions archive-actions"><button class="btn secondary" data-do="olderHistory">Παλαιότερες διαδρομές</button></div>':''}`}
function upcoming(){return `<h1>Προγραμματισμένες βόλτες</h1>${admin?'<button class="btn" data-go="new">+ Νέα βόλτα</button>':''}${active().length?active().map(rideCard).join(''):'<p class="empty">Καμία προγραμματισμένη βόλτα.</p>'}`}
function history(){const rides=completed();return `<h1>Ιστορικό διαδρομών</h1>${rides.length?rides.slice(0,historyLimit).map(rideCard).join(''):'<p class="empty">Καμία ολοκληρωμένη διαδρομή.</p>'}${rides.length>historyLimit?'<div class="actions archive-actions"><button class="btn secondary" data-do="moreHistory">Παλαιότερες διαδρομές</button></div>':''}`}
function newRide(){return `<h1>+ Νέα βόλτα</h1><div class="card"><form id="createRide"><label>Ημερομηνία <input required type="date" name="date" min="2020-01-01" value="${today()}"></label><label>Ώρα <input required type="time" name="time" value="09:00"></label><label>Σημείο συνάντησης <input required maxlength="120" name="place" placeholder="π.χ. Πλατεία Μαβίλη"></label><label>Τίτλος (προαιρετικά) <input maxlength="100" name="title" placeholder="π.χ. Γύρος λίμνης"></label><label>Εκτιμώμενα χιλιόμετρα (προαιρετικά) <input type="number" min="1" max="1000" step="0.1" name="estimate"></label><button class="btn">Δημοσίευση βόλτας</button></form></div>`}
function signup(r){return `<h1>Δήλωση συμμετοχής</h1><div class="card"><h2>${safe(r.title||'Ποδηλατική βόλτα')}</h2><p class="muted">${datefmt(r.date)} · ${safe(r.time)} · ${safe(r.place)}</p><form id="signupForm" data-id="${r.id}"><label>Το όνομά σου <input required maxlength="70" name="name" autocomplete="name" placeholder="Όνομα και επώνυμο"></label><button class="btn">Θα συμμετέχω</button></form><p class="note">Το όνομα θα είναι ορατό μόνο στους Admin. Η δήλωση αποθηκεύεται στην κοινή βάση της ομάδας.</p></div>`}
function finish(r){let names=[...new Set([...(r.signups||[]).map(x=>x.name),...db.riders.map(x=>x.name)])];return `<h1>Ολοκλήρωση βόλτας</h1><div class="card"><h2>${safe(r.title||'Ποδηλατική βόλτα')}</h2><form id="finishForm" data-id="${r.id}"><label>Πραγματική απόσταση (km) <input required name="km" type="number" min="0.1" max="1000" step="0.01"></label><label>Κοινή μέση ταχύτητα (km/h) <input required name="speed" type="number" min="1" max="100" step="0.1"></label><label>Υψομετρική ανάβαση (m) <input required name="elevationGain" type="number" min="0" max="50000" step="1" inputmode="numeric"></label><label>Χρόνος κίνησης (ώρες:λεπτά) <input required name="movingTime" type="text" inputmode="text" pattern="[0-9]{1,3}:[0-5][0-9]" placeholder="1:40" maxlength="6" aria-describedby="movingTimeHelp"></label><p id="movingTimeHelp" class="note">Μόνο ο χρόνος κίνησης από το Strava, χωρίς στάσεις (π.χ. 1:40).</p><label>Σύνδεσμος Strava (προαιρετικά) <input name="strava" type="url" placeholder="https://www.strava.com/activities/..."></label><p>Πραγματικοί συμμετέχοντες — επιλέξτε όσους ήρθαν</p>${names.length?names.map((n,i)=>`<label class="check"><input type="checkbox" name="person" value="${safe(n)}" ${(r.signups||[]).some(s=>s.name===n)?'checked':''}>${safe(n)}</label>`).join(''):'<p class="note">Δεν υπάρχουν ακόμη συμμετέχοντες. Πρόσθεσέ τους πρώτα από το μητρώο ποδηλατών.</p>'}<label>Ποιος δυσκολεύτηκε να ακολουθήσει; (προαιρετικά, μόνο Admin)</label>${names.map(n=>`<label class="check"><input type="checkbox" name="slowed" value="${safe(n)}">${safe(n)}</label>`).join('')}<label>Ιδιωτική παρατήρηση Admin (προαιρετικά)<textarea name="slowdownNotes" maxlength="2000" rows="3" placeholder="Σημείωση για τον ρυθμό των επιλεγμένων συμμετεχόντων"></textarea></label>${!completionV2?'<p class="alert">Απαιτείται ενημέρωση του backend πριν αποθηκευτούν τα νέα στοιχεία. Η βόλτα δεν έχει αλλάξει.</p>':''}<button class="btn" ${!completionV2?'disabled':''}>Αποθήκευση στο ιστορικό</button></form></div>`}
function riders(){let r=db.riders;return `<h1>Ποδηλάτες & επισκέπτες</h1><div class="card"><form id="addRider"><label>Όνομα <input name="name" required maxlength="70" placeholder="Όνομα και επώνυμο"></label><label class="check"><input type="checkbox" name="member" checked>Μόνιμο μέλος</label><button class="btn">Προσθήκη ποδηλάτη</button></form></div><div class="card">${r.length?r.map(x=>`<div class="item row rider-item">${riderAvatar(x)}<div class="rider-identity"><strong class="rider-name">${safe(x.name)}</strong><span class="rider-status ${x.member?'is-member':'is-guest'}">${x.member?'Μόνιμο μέλος':'Επισκέπτης'}</span></div><div class="rider-actions"><label class="btn secondary avatar-picker">${x.avatar_data_url?'Αλλαγή φωτογραφίας':'Προσθήκη φωτογραφίας'}<input type="file" accept="image/jpeg,image/png,image/webp" data-avatar-id="${safe(x.id)}" aria-label="Φωτογραφία για ${safe(x.name)}"></label>${x.avatar_data_url?`<button class="btn secondary" data-do="removeAvatar" data-id="${safe(x.id)}">Αφαίρεση φωτογραφίας</button>`:''}<button class="btn secondary" data-do="toggleMember" data-id="${x.id}">Αλλαγή τύπου</button></div></div>`).join(''):'<p class="muted">Δεν υπάρχουν καταχωρισμένοι ποδηλάτες.</p>'}</div>`}
function riderAvatar(r){const initials=r.name.trim().split(/\s+/).slice(0,2).map(n=>Array.from(n)[0]).join('').toLocaleUpperCase('el');return r.avatar_data_url&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(r.avatar_data_url)?`<img class="rider-avatar" src="${safe(r.avatar_data_url)}" alt="Φωτογραφία ${safe(r.name)}" width="56" height="56">`:`<span class="rider-avatar avatar-initials" aria-hidden="true">${safe(initials)}</span>`}
async function prepareAvatar(file){
 if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('Επίλεξε φωτογραφία JPG, PNG ή WebP έως 10 MB.');
 const image=await createImageBitmap(file);try{const canvas=document.createElement('canvas');canvas.width=192;canvas.height=192;const context=canvas.getContext('2d');context.fillStyle='#19251d';context.fillRect(0,0,192,192);const side=Math.min(image.width,image.height);context.drawImage(image,(image.width-side)/2,(image.height-side)/2,side,side,0,0,192,192);const result=canvas.toDataURL('image/jpeg',0.82);if(result.length>90000)throw Error('Η φωτογραφία είναι πολύ μεγάλη. Επίλεξε άλλη.');return result}finally{image.close()}
}
app.addEventListener('change',async e=>{const input=e.target;if(!input.dataset.avatarId||!admin||!input.files?.length)return;input.disabled=true;try{const avatar=await prepareAvatar(input.files[0]);await perform('setAvatar',{id:input.dataset.avatarId,avatar},'Η φωτογραφία αποθηκεύτηκε.')}catch(err){toast(err.message)}finally{input.disabled=false;input.value=''}});
function analytics(){let list=db.riders.map(p=>{let rides=completed().filter(r=>(r.attendees||[]).includes(p.name));let total=rides.reduce((s,r)=>s+Number(r.km),0);return {name:p.name,count:rides.length,km:total,elevation:rides.some(r=>r.elevationGain!=null)?rides.reduce((s,r)=>s+Number(r.elevationGain||0),0):null,moving:rides.some(r=>r.movingMinutes!=null)?rides.reduce((s,r)=>s+Number(r.movingMinutes||0),0):null,mean:rides.length?rides.reduce((s,r)=>s+Number(r.speed),0)/rides.length:0}}).sort((a,b)=>b.km-a.km);return `<h1>Στατιστικά ποδηλατών</h1><p class="alert">Ο κοινός μέσος όρος των διαδρομών δεν αποτελεί μέτρηση ατομικής ταχύτητας. Δεν παράγεται ακόμη αυτόματη κατάταξη.</p>${list.length?list.map(p=>`<article class="card"><div class="row"><strong>${safe(p.name)}</strong><span>${p.count} βόλτες</span></div><p>${p.km.toFixed(1)} km · Μ.Ο. ομάδων ${p.count?p.mean.toFixed(1)+' km/h':'—'}</p><p class="muted">Καταγεγραμμένη ανάβαση: ${p.elevation==null?'—':safe(p.elevation)+' m'} · Χρόνος κίνησης: ${p.moving==null?'—':safe(formatMovingTime(p.moving))}</p></article>`).join(''):'<p class="empty">Πρόσθεσε μέλη και ολοκληρωμένες βόλτες για να εμφανιστούν στατιστικά.</p>'}`}
function auth(){return `<h1>Είσοδος Admin</h1><div class="card"><p class="alert">Το PIN ελέγχεται από την υπηρεσία. Για μικρή ιδιωτική ομάδα μόνο.</p><form id="login"><label>PIN Admin <input type="password" name="pin" required inputmode="numeric" maxlength="4" minlength="4" pattern="[0-9]{4}" placeholder="••••"></label><button class="btn">Είσοδος</button></form><p class="note">Το PIN ορίζεται στα μυστικά του Supabase.</p></div>`}
function render(){if(!admin&&['new','riders','stats','finish'].includes(route))route='home';document.querySelector('#adminNav').classList.toggle('hidden',!admin);document.querySelector('#authBtn').textContent=admin?'Αποσύνδεση Admin':'Είσοδος Admin';let html=route==='home'?home():route==='upcoming'?upcoming():route==='history'?history():route==='new'?newRide():route==='riders'?riders():route==='stats'?analytics():route==='auth'?auth():route==='signup'&&window.currentRide?signup(window.currentRide):route==='finish'&&window.currentRide&&admin?finish(window.currentRide):home();app.innerHTML=renderNotice()+html;message=''}
document.querySelector('#menuBtn').onclick=()=>{nav.classList.toggle('hidden');document.querySelector('#menuBtn').setAttribute('aria-expanded',String(!nav.classList.contains('hidden')))};
nav.addEventListener('click',async e=>{let b=e.target.closest('button');if(!b)return;if(b.dataset.route)navigate(b.dataset.route);else if(b.id==='authBtn'){if(admin){try{await api('logout')}catch{toast('Η σύνδεση αφαιρέθηκε από αυτή τη συσκευή. Η υπηρεσία δεν ήταν διαθέσιμη.')}finally{admin=false;pin='';adminToken='';writeLocal('voltesAdminToken','');try{await refresh()}catch{db.riders=[];db.rides=[]}navigate('home')}}else navigate('auth')}});
app.addEventListener('click',async e=>{
 let b=e.target.closest('button');if(!b)return;
 if(b.dataset.go){navigate(b.dataset.go);return}
 if(!b.dataset.do)return;
 let r=db.rides.find(x=>x.id===b.dataset.id);
 switch(b.dataset.do){
 case 'signup':window.currentRide=r;navigate('signup');break;
 case 'olderHistory':historyLimit=10;route='history';render();window.scrollTo(0,0);break;
 case 'moreHistory':historyLimit+=5;render();break;
 case 'cancelSignup':if(!r||!signupTokens[r.id])return;if(confirm('Να ακυρωθεί η συμμετοχή σου;')){b.disabled=true;try{await api('cancelSignup',{id:r.id,cancelToken:signupTokens[r.id]});delete signupTokens[r.id];saveSignupTokens();await refresh();toast('Η συμμετοχή σου ακυρώθηκε.')}catch(err){b.disabled=false;toast(err.message)}}break;
 case 'removeAvatar':if(admin&&confirm('Να αφαιρεθεί η φωτογραφία;'))await perform('setAvatar',{id:b.dataset.id,avatar:null},'Η φωτογραφία αφαιρέθηκε.');break;
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
  try{const result=await api('login');adminToken=result.adminToken;pin='';if(!adminToken)throw Error('Απαιτείται ενημέρωση της υπηρεσίας.');if(!writeLocal('voltesAdminToken',adminToken))message='Η σύνδεση ισχύει για τώρα, αλλά ο browser δεν επιτρέπει να αποθηκευτεί.';await refresh();navigate('home')}
  catch(err){pin='';adminToken='';writeLocal('voltesAdminToken','');toast(err.message)}
 }else if(f.id==='createRide'&&admin){
  if(await perform('create',values,'Η βόλτα δημοσιεύτηκε.'))navigate('upcoming');
 }else if(f.id==='addRider'&&admin){
  await perform('addRider',{name:values.name,member:d.has('member')},'Ο ποδηλάτης προστέθηκε.');
 }else if(f.id==='signupForm'){
  const id=f.dataset.id;signupTokens[id] ||= newToken();
  if(!saveSignupTokens()){toast('Ο browser δεν επιτρέπει αποθήκευση. Ενεργοποίησέ την για να μπορείς να ακυρώσεις τη δήλωσή σου.');return}
  const button=f.querySelector('button');button.disabled=true;
  try{await api('signup',{id,name:values.name,cancelToken:signupTokens[id]});await refresh();navigate('upcoming');toast('Η δήλωση συμμετοχής καταχωρίστηκε.')}catch(err){button.disabled=false;toast(err.message)}
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
