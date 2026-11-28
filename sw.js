/* Cycling PWA offline shell and new-ride Web Push receiver. */
const CACHE="podilasia-ui-v113-profile-cosmetics";
const ASSETS=[
  "./",'./index.html','./style.css?v=95','./app.js?v=98',
  './voltes-push.js?v=5','./completion.js','./strava-ocr.js?v=40',
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
/* Instant app shell: serve previously saved files and revalidate silently.
   Never store API data; external Supabase requests always reach the network. */
self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (req.method !== "GET" || url.origin !== scope.origin ||
      !url.pathname.startsWith(scope.pathname)) return;
  const staticRequest = req.mode === "navigate" ||
    ["script", "style", "image", "font", "manifest"].includes(req.destination);
  if (!staticRequest) return;

  const network = fetch(req, {cache: "no-cache"}).then(async response => {
    if (response.ok && response.type === "basic") {
      try {
        const cache = await caches.open(CACHE);
        await cache.put(req, response.clone());
      } catch (_) {}
    }
    return response;
  });
  event.waitUntil(network.then(() => {}, () => {}));

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.cache !== "reload" && req.cache !== "no-store") {
      const cached = await cache.match(req, {ignoreSearch: req.mode === "navigate"}) ||
        (req.mode === "navigate" ? await cache.match("./index.html") : null);
      if (cached) return cached;
    }
    try { return await network; }
    catch {
      return await cache.match(req, {ignoreSearch: req.mode === "navigate"}) ||
        (req.mode === "navigate" ? await cache.match("./index.html") : null) ||
        Response.error();
    }
  })());
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
