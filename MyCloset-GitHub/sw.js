const CACHE='mycloset-shell-v4-public-bota-20261027';
const CORE=['./','./styles.css','./app.mjs','./model.mjs','./stylist.mjs','./shopping.mjs','./platform.mjs','./qrcode.mjs','./weather.mjs','./manifest.webmanifest','./assets/style-editorial.webp','./assets/fonts/manrope.ttf','./assets/fonts/cormorant-garamond.ttf','./assets/fonts/cormorant-garamond-italic.ttf','./assets/app-icon-192.png','./assets/app-icon-512.png'];
async function cacheable(response,url){
  if(!response.ok||response.redirected||['opaque','opaqueredirect'].includes(response.type))return false;
  const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  const path=url.pathname;
  if(/\.(mjs|js)$/.test(path))return ['text/javascript','application/javascript'].includes(mime);
  if(path.endsWith('.css'))return mime==='text/css';
  if(path.endsWith('.webmanifest'))return ['application/manifest+json','application/json'].includes(mime);
  if(path.endsWith('.ttf'))return ['font/ttf','application/x-font-ttf','application/octet-stream'].includes(mime);
  if(path.endsWith('.png'))return mime==='image/png';
  if(path.endsWith('.webp'))return mime==='image/webp';
  return mime==='text/html'&&(await response.clone().text()).includes('name="mycloset-app"');
}
self.addEventListener('install',event=>{event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await Promise.all(CORE.map(async path=>{
    const url=new URL(path,self.registration.scope);
    const response=await fetch(url,{cache:'reload',credentials:'same-origin'});
    if(!await cacheable(response,url))throw new Error('App resource unavailable');
    await cache.put(url,response);
  }));
  if(!self.registration.active)await self.skipWaiting();
})());});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('mycloset-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})());});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')void self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.includes('/api/')||request.cache==='only-if-cached'&&request.mode!=='same-origin')return;
  const known=CORE.some(path=>new URL(path,self.registration.scope).pathname===url.pathname);
  if(!known||request.mode==='navigate'&&url.search)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{
      const response=await fetch(request);
      if(await cacheable(response,url))await cache.put(request,response.clone());
      return response;
    }catch(error){
      const cached=await cache.match(request)||request.mode==='navigate'&&await cache.match(new URL('./',self.registration.scope));
      if(cached)return cached;
      throw error;
    }
  })());
});
