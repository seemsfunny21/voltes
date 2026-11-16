/* Cycling PWA offline shell and new-ride Web Push receiver. */
const CACHE="podilasia-ui-v71-new-ride-push";
const ASSETS=[
  "./",'./index.html','./style.css?v=66','./app.js?v=68',
  './voltes-push.js?v=1','./completion.js','./strava-ocr.js?v=40',
  './config.js','./icon.svg?v=2','./hero-cyclist.webp','./manifest.webmanifest'
];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  // CacheStorage belongs to the entire GitHub Pages origin, not only /voltes/.
  // Never remove the Reminder/Parking caches maintained by other apps.
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(x=>x.startsWith("podilasia-")&&x!==CACHE).map(x=>caches.delete(x)))),
    self.clients.claim()
  ]));
});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});
self.addEventListener("push",event=>{
  let payload={};
  try{payload=event.data?event.data.json():{}}catch{}
  const title=typeof payload.title==="string"?payload.title:"🚴 Νέα βόλτα στην παρέα!";
  const body=typeof payload.body==="string"?payload.body:"Άνοιξε την εφαρμογή για λεπτομέρειες.";
  const tag=typeof payload.tag==="string"?payload.tag:"voltes-new-ride";
  const url=new URL("./",self.registration.scope).href;
  event.waitUntil(self.registration.showNotification(title,{
    body,tag,
    icon:new URL("./icon.svg?v=2",self.registration.scope).href,
    badge:new URL("./icon.svg?v=2",self.registration.scope).href,
    data:{url},requireInteraction:false
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const url=new URL("./",self.registration.scope).href;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of windows){
      if(client.url.startsWith(url)){
        await client.focus();
        return;
      }
    }
    if(self.clients.openWindow)await self.clients.openWindow(url);
  })());
});
