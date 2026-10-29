const CACHE='mycloset-next-shell-v5';
const CORE=['./','./styles.css','./bootstrap.min.css','./shell.html','./app.mjs','./model.mjs','./stylist.mjs','./shopping.mjs','./shopping-filters.mjs','./platform.mjs','./qrcode.mjs','./weather.mjs','./manifest.webmanifest','./assets/style-editorial.webp','./assets/fonts/manrope.ttf','./assets/fonts/cormorant-garamond.ttf','./assets/fonts/cormorant-garamond-italic.ttf','./assets/app-icon-192.png','./assets/app-icon-512.png'];
async function cacheable(response,url){
  if(!response.ok||response.redirected||['opaque','opaqueredirect'].includes(response.type))return false;
  const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  const path=url.pathname;
  if(/\.(mjs|js)$/.test(path))return ['text/javascript','application/javascript'].includes(mime);
  if(path.endsWith('.css'))return mime==='text/css';
  if(path.endsWith('.webmanifest'))return ['application/manifest+json','application/json'].includes(mime);
  if(path.endsWith('.ttf'))return ['font/ttf','application/x-font-ttf','application/octet-stream'].includes(mime);
  if(path.endsWith('.woff2'))return mime==='font/woff2';
  if(path.endsWith('.png'))return mime==='image/png';
  if(path.endsWith('.webp'))return mime==='image/webp';
  if(path.endsWith('.svg'))return mime==='image/svg+xml';
  if(path.endsWith('/shell.html'))return mime==='text/html';
  return mime==='text/html'&&(await response.clone().text()).includes('name="mycloset-app"');
}
self.addEventListener('install',event=>{event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await Promise.all(CORE.map(async path=>{
    const url=new URL(path,self.registration.scope);
    const response=await fetch(url,{cache:'reload',credentials:'same-origin'});
    if(!await cacheable(response,url))throw new Error('App resource unavailable');
    await cache.put(url,response.clone());
  }));
  if(!self.registration.active)await self.skipWaiting();
})());});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('mycloset-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})());});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')void self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url),path=url.pathname;
  if(request.method!=='GET'||url.origin!==self.location.origin||path.includes('/api/')||path==='/auth'||path.startsWith('/auth/')||request.cache==='only-if-cached'&&request.mode!=='same-origin')return;
  const corePath=CORE.some(item=>new URL(item,self.registration.scope).pathname===path);
  const nextAsset=path.startsWith('/_next/static/')&&/\.(?:js|css|woff2)$/.test(path);
  if(!corePath&&!nextAsset||request.mode==='navigate'&&url.search)return;
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