/* Voltes: opt-in Web Push for newly published rides.
   Separate from Reminder and the existing Voltes admin/bike features. */
(()=>{
 "use strict";
 const API="https://zrbmsziipzabnniqcpav.supabase.co/functions/v1/voltes-push";
 const STORAGE_KEY="voltes.push.device.v1";
 const $=id=>document.getElementById(id);
 let active=false,busy=false,lastMessage="";
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
   const enable=$("voltesPushEnable"),test=$("voltesPushTest"),disable=$("voltesPushDisable");
   if(!state||!enable||!test||!disable)return;
   let message="";
   if(!supported())message="Η συσκευή ή ο browser δεν υποστηρίζει Web Push.";
   else if(Notification.permission==="denied")message="Οι ειδοποιήσεις είναι αποκλεισμένες. Επίτρεψέ τες από τις ρυθμίσεις της εφαρμογής.";
   else if(active)message="● Push ενεργό · Θα ενημερώνεσαι όταν δημοσιεύεται νέα βόλτα.";
   else message="Ενεργοποίησε τις ειδοποιήσεις για να μαθαίνεις για κάθε νέα βόλτα, ακόμη και με κλειστή εφαρμογή.";
   state.textContent=lastMessage||message;
   state.classList.toggle("is-active",active);
   enable.hidden=active || !supported();
   enable.disabled=busy||Notification.permission==="denied";
   test.hidden=!active;disable.hidden=!active;
   test.disabled=busy;disable.disabled=busy;
 }
 async function worker(){
   return await navigator.serviceWorker.register("./sw.js",{scope:"./"});
 }
 async function enable(){
   if(!supported())return setMessage("Οι ειδοποιήσεις Push δεν υποστηρίζονται σε αυτή τη συσκευή.");
   if(busy)return;
   busy=true;setMessage("Σύνδεση Push…");
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
     active=true;setMessage("● Push ενεργό · Θα ενημερώνεσαι για κάθε νέα βόλτα.");
   }catch(error){active=false;setMessage(error?.message||"Η ενεργοποίηση Push απέτυχε.");}
   finally{busy=false;updateUi()}
 }
 async function test(){
   if(busy||!active)return;
   const credentials=readCredentials();
   if(!credentials)return setMessage("Χρειάζεται νέα ενεργοποίηση Push.");
   busy=true;setMessage("Αποστολή δοκιμαστικής ειδοποίησης…");
   try{
     await request("test",credentials);
     setMessage("Η δοκιμαστική ειδοποίηση στάλθηκε. Έλεγξε το κινητό σου.");
   }catch(error){setMessage(error?.message||"Η δοκιμή απέτυχε.");}
   finally{busy=false;updateUi()}
 }
 async function disable(){
   if(busy)return;
   const credentials=readCredentials();
   busy=true;setMessage("Απενεργοποίηση ειδοποιήσεων…");
   try {
     if(credentials)await request("disable",credentials);
     const reg=await navigator.serviceWorker.getRegistration(new URL("./",location.href).href);
     const subscription=await reg?.pushManager.getSubscription();
     if(subscription)await subscription.unsubscribe();
     removeCredentials();active=false;
     setMessage("Οι ειδοποιήσεις νέας βόλτας απενεργοποιήθηκαν.");
   }catch(error){setMessage(error?.message||"Η απενεργοποίηση απέτυχε.");}
   finally{busy=false;updateUi()}
 }
 async function init(){
   updateUi();
   if(!supported()||Notification.permission!=="granted")return;
   const credentials=readCredentials();
   if(!credentials)return;
   try{
     const reg=await navigator.serviceWorker.getRegistration(new URL("./",location.href).href);
     const subscription=await reg?.pushManager.getSubscription();
     if(!subscription)return;
     await request("register",{...credentials,subscription:subscription.toJSON()});
     active=true;lastMessage="";updateUi();
   }catch(error){
     console.warn("Voltes Push: registration check failed",String(error));
     active=false;setMessage("Η σύνδεση Push χρειάζεται ανανέωση. Πάτησε Ενεργοποίηση.");
   }
 }
 document.addEventListener("click",event=>{
   const button=event.target.closest?.("button");
   if(!button)return;
   if(button.id==="voltesPushEnable"){event.preventDefault();enable();}
   else if(button.id==="voltesPushTest"){event.preventDefault();test();}
   else if(button.id==="voltesPushDisable"){event.preventDefault();disable();}
 });
 window.VoltesPush={updateUi,init};
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
 else init();
})();
