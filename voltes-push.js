/* Voltes: opt-in Web Push for newly published rides.
   Separate from Reminder and the existing Voltes admin/bike features. */
(()=>{
 "use strict";
 const API="https://zrbmsziipzabnniqcpav.supabase.co/functions/v1/voltes-push";
 const STORAGE_KEY="voltes.push.device.v1";
 const $=id=>document.getElementById(id);
 let active=false,busy=false,checking=true,lastMessage="",lastCheck=0;
 const ADMIN_ALERT_KEY="voltes.keepalive.admin-push.v1";
 let keepaliveAlerts=false;
 try{keepaliveAlerts=localStorage.getItem(ADMIN_ALERT_KEY)==="yes"}catch{}
 const setKeepaliveAlerts=value=>{
  keepaliveAlerts=!!value;
  try{if(value)localStorage.setItem(ADMIN_ALERT_KEY,"yes");else localStorage.removeItem(ADMIN_ALERT_KEY)}catch{}
 };
 const supported=()=>window.isSecureContext && "Notification" in window &&
   "serviceWorker" in navigator && "PushManager" in window;
 const encode64=bytes=>{
   let output="";for(const b of bytes)output+=String.fromCharCode(b);
   return btoa(output).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
 };
 const decode64=value=>{
   const s=atob(value.replaceAll("-","+").replaceAll("_","/"));
   return Uint8Array.from(s,c=>c.charCodeAt(0));
 };
 const readCredentials=()=>{
   try {
     const data=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
     if(data&&typeof data.deviceId==="string"&&typeof data.token==="string")return data;
   }catch{}
   return null;
 };
 const makeCredentials=()=>({
   deviceId:crypto.randomUUID(),
   token:encode64(crypto.getRandomValues(new Uint8Array(48)))
 });
 const saveCredentials=value=>{
   try{localStorage.setItem(STORAGE_KEY,JSON.stringify(value));return true}catch{return false}
 };
 const removeCredentials=()=>{try{localStorage.removeItem(STORAGE_KEY)}catch{}};
 async function request(action,data={}) {
   const response=await fetch(API,{
     method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({action,...data}),cache:"no-store"
   });
   let result;try{result=await response.json()}catch{throw Error("Αποτυχία επικοινωνίας με την υπηρεσία Push.")}
   if(!response.ok||!result.ok)throw Error(result.error||"Η υπηρεσία Push δεν είναι διαθέσιμη.");
   return result;
 }
 function setMessage(message){lastMessage=message;updateUi()}
 function updateUi() {
   const state=$("voltesPushState");
   const enable=$("voltesPushEnable"),disable=$("voltesPushDisable");
   if(!state||!enable||!disable)return;
   const supportedHere=supported();
   const permitted=supportedHere&&Notification.permission==="granted";
   const confirmed=active&&!checking&&permitted;
   let message="";
   if(checking)message="◌ Έλεγχος σύνδεσης Push…";
   else if(!supportedHere)message="Η συσκευή ή ο browser δεν υποστηρίζει Web Push.";
   else if(Notification.permission==="denied")message="Οι ειδοποιήσεις είναι αποκλεισμένες από το Android. Επίτρεψέ τες από τις ρυθμίσεις της εφαρμογής.";
   else if(confirmed)message="✓ Push ενεργό · Θα λαμβάνεις νέες βόλτες και προειδοποιήσεις βροχής.";
   else message="○ Push ανενεργό · Ενεργοποίησέ το για νέες βόλτες και προειδοποιήσεις βροχής.";
   // A previous success message must never masquerade as current verification.
   state.textContent=checking?message:(lastMessage||message);
   state.classList.toggle("is-active",confirmed);
   state.classList.toggle("is-checking",checking);
   enable.hidden=false;disable.hidden=false;
   enable.textContent=confirmed?"✓ Ενεργό":"Ενεργοποίηση";
   disable.textContent=!checking&&!confirmed?"✓ Ανενεργό":"Απενεργοποίηση";
   enable.classList.toggle("is-selected",confirmed);
   disable.classList.toggle("is-selected",!checking&&!confirmed);
   enable.setAttribute("aria-pressed",String(confirmed));
   disable.setAttribute("aria-pressed",String(!checking&&!confirmed));
   enable.disabled=busy||checking||confirmed||!supportedHere||Notification.permission==="denied";
   disable.disabled=busy||checking||!confirmed;
   state.dataset.pushStatus=checking?"checking":confirmed?"active":"inactive";
 }
 async function worker(){
   return await navigator.serviceWorker.register("./sw.js",{scope:"./"});
 }
 async function enable(){
   if(!supported())return setMessage("Οι ειδοποιήσεις Push δεν υποστηρίζονται σε αυτή τη συσκευή.");
   if(busy||checking)return;
   busy=true;lastMessage="Σύνδεση Push…";updateUi();
   try{
     // Permission request must begin in the direct user-click gesture.
     const permission=Notification.permission==="granted"
       ? "granted" : await Notification.requestPermission();
     if(permission!=="granted")throw Error("Δεν δόθηκε άδεια ειδοποιήσεων.");
     const reg=await worker();
     const configResponse=await fetch(API,{cache:"no-store"});
     if(!configResponse.ok)throw Error("Δεν βρέθηκαν οι ρυθμίσεις Push.");
     const config=await configResponse.json();
     if(!config?.vapidPublicKey)throw Error("Δεν βρέθηκε το δημόσιο κλειδί Push.");
     const subscription=await reg.pushManager.getSubscription() ||
       await reg.pushManager.subscribe({
         userVisibleOnly:true,applicationServerKey:decode64(config.vapidPublicKey)
       });
     let credentials=readCredentials();
     if(!credentials)credentials=makeCredentials();
     if(!saveCredentials(credentials))throw Error("Δεν επιτρέπεται η αποθήκευση στη συσκευή.");
     await request("register",{...credentials,subscription:subscription.toJSON()});
     active=true;lastMessage="";updateUi();
   }catch(error){active=false;setMessage(error?.message||"Η ενεργοποίηση Push απέτυχε.");}
   finally{busy=false;updateUi()}
 }
 async function disable(){
   if(busy)return;
   const credentials=readCredentials();
   busy=true;lastMessage="Απενεργοποίηση ειδοποιήσεων…";updateUi();
   try {
     if(credentials)await request("disable",credentials);
     const reg=await navigator.serviceWorker.getRegistration(new URL("./",location.href).href);
     const subscription=await reg?.pushManager.getSubscription();
     if(subscription)await subscription.unsubscribe();
     removeCredentials();active=false;setKeepaliveAlerts(false);
     setMessage("Οι ειδοποιήσεις βόλτας και καιρού απενεργοποιήθηκαν.");
   }catch(error){setMessage(error?.message||"Η απενεργοποίηση απέτυχε.");}
   finally{busy=false;updateUi()}
 }
 async function enableKeepaliveAlerts(adminToken){
   if(!adminToken)throw Error("Συνδέσου πρώτα ως Admin.");
   if(!supported())throw Error("Η συσκευή δεν υποστηρίζει Push.");
   if(!active){await enable();if(!active)throw Error("Πρέπει πρώτα να ενεργοποιήσεις τις ειδοποιήσεις Push.");}
   const credentials=readCredentials();
   if(!credentials)throw Error("Δεν υπάρχουν στοιχεία ειδοποιήσεων σε αυτή τη συσκευή.");
   await request("adminAlerts",{...credentials,adminToken,enabled:true});
   setKeepaliveAlerts(true);
   return true;
 }
 async function disableKeepaliveAlerts(adminToken){
   if(!adminToken)throw Error("Συνδέσου πρώτα ως Admin.");
   const credentials=readCredentials();
   if(credentials)await request("adminAlerts",{...credentials,adminToken,enabled:false});
   setKeepaliveAlerts(false);
   return true;
 }
 async function init(){
   if(busy||checking&&lastCheck)return;
   const now=Date.now();
   if(lastCheck&&now-lastCheck<60000)return;
   lastCheck=now;
   checking=true;active=false;lastMessage="";updateUi();
   try{
     if(!supported()||Notification.permission!=="granted")return;
     const credentials=readCredentials();
     if(!credentials)return;
     const reg=await navigator.serviceWorker.getRegistration(new URL("./",location.href).href);
     const subscription=await reg?.pushManager.getSubscription();
     if(!subscription){
       lastMessage="Η εγγραφή Push λείπει από αυτή τη συσκευή. Πάτησε Ενεργοποίηση.";
       return;
     }
     // The button becomes active only after the server acknowledges the
     // current browser subscription; permission alone is insufficient.
     await request("register",{...credentials,subscription:subscription.toJSON()});
     active=true;
   }catch(error){
     console.warn("Voltes Push: registration check failed",String(error));
     active=false;
     lastMessage="Η σύνδεση Push δεν επιβεβαιώθηκε. Πάτησε Ενεργοποίηση για νέα προσπάθεια.";
   }finally{
     checking=false;
     updateUi();
   }
 }
 document.addEventListener("visibilitychange",()=>{
   if(document.visibilityState==="visible")init();
 });
 window.addEventListener("pageshow",()=>init());
 document.addEventListener("click",event=>{
   const button=event.target.closest?.("button");
   if(!button)return;
   if(button.id==="voltesPushEnable"){event.preventDefault();enable();}
   else if(button.id==="voltesPushDisable"){event.preventDefault();disable();}
 });
 window.VoltesPush={updateUi,init,enableKeepaliveAlerts,disableKeepaliveAlerts,keepaliveAlertsActive:()=>active&&!checking&&keepaliveAlerts};
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
 else init();
})();
