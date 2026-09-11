const CACHE='flowmap-shell-v0.7.9';
const ASSETS=[
  './','./index.html','./styles.css?v=0.7.9','./finance-engine-1.0.4.js','./app.js?v=0.7.9','./manifest.webmanifest','./version.json',
  './icons/flowmap-64.png','./icons/flowmap-192.png','./icons/flowmap-512.png','./icons/apple-touch-icon.png','./icons/flowmap-mark.png'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

function networkFirst(request){
  return fetch(request,{cache:'no-store'}).then(response=>{
    if(response&&response.ok){
      const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));
    }
    return response;
  }).catch(()=>caches.match(request));
}

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.pathname.endsWith('/version.json')||url.pathname.endsWith('version.json')){
    event.respondWith(fetch(event.request,{cache:'no-store'}));return;
  }
  if(event.request.mode==='navigate'){
    event.respondWith(networkFirst(event.request).then(r=>r||caches.match('./index.html').then(x=>x||caches.match('./'))));return;
  }
  const isCore=url.origin===self.location.origin&&(
    url.pathname.endsWith('/app.js')||url.pathname.endsWith('/finance-engine-1.0.4.js')||url.pathname.endsWith('/styles.css')
  );
  if(isCore){event.respondWith(networkFirst(event.request));return}
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    if(response&&response.ok&&url.origin===self.location.origin){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy))}
    return response;
  })));
});
