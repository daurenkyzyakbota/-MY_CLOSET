import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import vm from 'node:vm';
import {QrCode} from '../qrcode.mjs';
import {HOSTED_URL,requestAppJson} from '../platform.mjs';

const site=new URL('../',import.meta.url);
const workerSource=await readFile(new URL('sw.js',site),'utf8');
const core=vm.runInNewContext(workerSource.match(/const CORE=(\[[\s\S]*?\]);/)[1]);

function shellResponse(url) {
  const path=new URL(url).pathname;
  const type=path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.webmanifest')?'application/manifest+json':path.endsWith('.ttf')?'font/ttf':path.endsWith('.png')?'image/png':path.endsWith('.webp')?'image/webp':'text/html';
  return new Response(type==='text/html'?'<meta name="mycloset-app" content="MyCloset">':'resource',{headers:{'Content-Type':type}});
}
function workerHarness(fetcher=async url=>shellResponse(url),scope=HOSTED_URL) {
  const handlers=new Map(),entries=new Map(),deleted=[];
  const key=request=>request.url || String(request);
  const cache={put:async(request,response)=>{entries.set(key(request),response);},match:async request=>entries.get(key(request))};
  const self={registration:{scope,active:null},location:{origin:new URL(scope).origin},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(name,handler)=>handlers.set(name,handler)};
  vm.runInNewContext(workerSource,{self,URL,caches:{open:async()=>cache,keys:async()=>['mycloset-shell-old','some-other-cache'],delete:async name=>deleted.push(name)},fetch:fetcher,Response});
  return {handlers,entries,deleted};
}
function fetchEvent(url,overrides={}) {let promise=null;return{request:{url,method:'GET',mode:'same-origin',cache:'default',...overrides},respondWith:value=>{promise=value;},get promise(){return promise;}};}

test('manifest and every offline core resource exist with valid PNG icon dimensions',async()=>{
  const manifest=JSON.parse(await readFile(new URL('manifest.webmanifest',site),'utf8'));
  assert.equal(manifest.display,'standalone');assert.equal(manifest.lang,'ru');assert.equal(new URL(manifest.start_url,HOSTED_URL).href,HOSTED_URL);assert.equal(new URL(manifest.scope,HOSTED_URL).href,HOSTED_URL);
  for(const path of core)await access(new URL(path==='./'?'index.html':path,site));
  for(const icon of manifest.icons){const bytes=await readFile(new URL(icon.src,site));assert.equal(bytes.subarray(1,4).toString(),'PNG');const size=Number(icon.sizes.split('x')[0]);assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);assert.ok(core.includes('./'+icon.src));}
});

test('QR output preserves all three standard finder patterns and includes the MIT notice',async()=>{
  const qr=QrCode.encodeText(HOSTED_URL,QrCode.Ecc.MEDIUM);assert.equal((qr.size-21)%4,0);assert.ok(qr.size>=21&&qr.size<=177);
  for(const [left,top] of [[0,0],[qr.size-7,0],[0,qr.size-7]])for(let y=0;y<7;y++)for(let x=0;x<7;x++){const dark=x===0||x===6||y===0||y===6||(x>=2&&x<=4&&y>=2&&y<=4);assert.equal(qr.getModule(left+x,top+y),dark);}
  const matrix=value=>Array.from({length:value.size},(_,y)=>Array.from({length:value.size},(_,x)=>Number(value.getModule(x,y))).join('')).join('\n');
  assert.equal(matrix(qr),matrix(QrCode.encodeText(HOSTED_URL,QrCode.Ecc.MEDIUM)));assert.notEqual(matrix(qr),matrix(QrCode.encodeText(HOSTED_URL+'?different=1',QrCode.Ecc.MEDIUM)));
  const source=await readFile(new URL('qrcode.mjs',site),'utf8');assert.match(source,/Project Nayuki/);assert.match(source,/MIT License/);assert.match(source,/Permission is hereby granted/);
});

test('service worker caches installation shell and serves it after network failure',async()=>{
  const harness=workerHarness();let installation;harness.handlers.get('install')({waitUntil:value=>{installation=value;}});await installation;assert.equal(harness.entries.size,core.length);
  const offline=workerHarness(async()=>{throw new TypeError('Offline');});for(const [key,value]of harness.entries)offline.entries.set(key,value);
  for(const path of ['/','/app.mjs','/styles.css']){const event=fetchEvent(new URL(path,HOSTED_URL).href,{mode:path==='/'?'navigate':'same-origin'});offline.handlers.get('fetch')(event);assert.ok(event.promise);assert.equal((await event.promise).status,200);}
});

test('service worker never handles API, cross-origin, non-GET, auth routes or queried navigations',()=>{
  const {handlers}=workerHarness();
  for(const [url,overrides]of [[new URL('/api/device',HOSTED_URL).href,{}],[new URL('/api/weather?lat=1&lon=1',HOSTED_URL).href,{}],['https://api.open-meteo.com/v1/forecast',{}],[new URL('/app.mjs',HOSTED_URL).href,{method:'POST'}],[new URL('/auth/login',HOSTED_URL).href,{mode:'navigate'}],[new URL('/?token=private-auth-token',HOSTED_URL).href,{mode:'navigate'}]]){const event=fetchEvent(url,overrides);handlers.get('fetch')(event);assert.equal(event.promise,null,url);}
});

test('redirected login responses never replace the cached shell, and cleanup preserves unrelated caches',async()=>{
  const harness=workerHarness(async()=>({ok:true,redirected:true,status:200,clone:()=>new Response('login')}));const event=fetchEvent(new URL('/app.mjs',HOSTED_URL).href);harness.handlers.get('fetch')(event);await event.promise;assert.equal(harness.entries.size,0);
  let activation;harness.handlers.get('activate')({waitUntil:value=>{activation=value;}});await activation;assert.deepEqual(harness.deleted,['mycloset-shell-old']);
});

test('200 HTML login or fallback pages cannot poison module caches or report a ready shell',async()=>{
  const harness=workerHarness(async()=>new Response('<h1>Sign in</h1>',{headers:{'Content-Type':'text/html'}}));
  for(const path of ['/','/app.mjs','/styles.css']){const event=fetchEvent(new URL(path,HOSTED_URL).href,{mode:path==='/'?'navigate':'same-origin'});harness.handlers.get('fetch')(event);await event.promise;assert.equal(harness.entries.size,0);}
  let installation;harness.handlers.get('install')({waitUntil:value=>{installation=value;}});await assert.rejects(installation,/App resource unavailable/);
});

test('hosted and local DNS routing are distinct and weather uses credential-free fixed HTTPS endpoints',async()=>{
  const previousLocation=globalThis.location,previousDocument=globalThis.document,previousFetch=globalThis.fetch;
  try{
    globalThis.document={querySelector:()=>null};globalThis.location=new URL('http://my-computer.local:4173/');let localCalls=0;
    globalThis.fetch=async url=>{localCalls++;assert.equal(new URL(url).hostname,'my-computer.local');return Response.json({isHosted:false});};assert.equal((await requestAppJson('/api/device')).isHosted,false);assert.equal(localCalls,1);
    globalThis.location=new URL(HOSTED_URL);assert.equal((await requestAppJson('/api/device')).isHosted,true);assert.equal(localCalls,1);await assert.rejects(requestAppJson('https://evil.example/api/device'),/Недопустимый/);
    let weatherCalls=0;globalThis.fetch=async(url,options)=>{weatherCalls++;assert.equal(new URL(url).origin,'https://geocoding-api.open-meteo.com');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.deepEqual(Object.keys(options.headers),['Accept']);return Response.json({results:[{id:1,name:'Кызылорда',country:'Казахстан',admin1:'Кызылординская область',latitude:44.85,longitude:65.5,timezone:'Asia/Qyzylorda'}]});};
    const result=await requestAppJson('/api/cities?q=Кызылорда');assert.equal(result.cities[0].name,'Кызылорда');assert.equal(weatherCalls,1);
  }finally{globalThis.location=previousLocation;globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});

test('HTTPS static hosting retains the repository prefix in device links',async()=>{
  const previousLocation=globalThis.location,previousDocument=globalThis.document,previousFetch=globalThis.fetch;
  try{
    globalThis.document={querySelector:selector=>selector==='meta[name="mycloset-hosting"]'?{content:'online'}:null};
    globalThis.fetch=async()=>{throw new Error('A hosted device link must not require a backend.');};
    for(const href of ['https://example.github.io/-MY_CLOSET/','https://example.github.io/-MY_CLOSET/index.html?source=bookmark#devices']){
      globalThis.location=new URL(href);const device=await requestAppJson('/api/device');
      assert.equal(device.isHosted,true);assert.equal(device.localUrl,'https://example.github.io/-MY_CLOSET/');assert.equal(device.hostedUrl,'https://example.github.io/-MY_CLOSET/');assert.equal(device.preferredPhoneUrl,device.hostedUrl);assert.deepEqual(device.phoneUrls,[device.hostedUrl]);
    }
  }finally{globalThis.location=previousLocation;globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});

test('HTTP local static preview shares the published address instead of a phone-unreachable localhost link',async()=>{
  const previousLocation=globalThis.location,previousDocument=globalThis.document,previousFetch=globalThis.fetch;
  try{
    globalThis.document={querySelector:()=>({content:'online'})};globalThis.location=new URL('http://localhost:3000/preview/index.html');globalThis.fetch=async()=>{throw new Error('Static device mode must not fetch a local API.');};
    const device=await requestAppJson('/api/device');assert.equal(device.localUrl,'http://localhost:3000/preview/');assert.equal(device.hostedUrl,HOSTED_URL);assert.equal(device.preferredPhoneUrl,HOSTED_URL);assert.deepEqual(device.phoneUrls,[HOSTED_URL]);
  }finally{globalThis.location=previousLocation;globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});

test('relative manifest and service worker cache stay inside a nested hosting prefix',async()=>{
  const scope='https://example.github.io/-MY_CLOSET/';const manifest=JSON.parse(await readFile(new URL('manifest.webmanifest',site),'utf8'));
  for(const property of ['id','start_url','scope'])assert.equal(new URL(manifest[property],scope).href,scope);
  const online=workerHarness(undefined,scope);let installation;online.handlers.get('install')({waitUntil:value=>{installation=value;}});await installation;
  assert.equal(online.entries.size,core.length);assert.ok([...online.entries.keys()].every(url=>url.startsWith(scope)));
  const offline=workerHarness(async()=>{throw new TypeError('Offline');},scope);for(const [key,value]of online.entries)offline.entries.set(key,value);
  for(const path of ['./','./app.mjs','./styles.css']){const event=fetchEvent(new URL(path,scope).href,{mode:path==='./'?'navigate':'same-origin'});offline.handlers.get('fetch')(event);assert.ok(event.promise);assert.equal((await event.promise).status,200);}
  const sibling=fetchEvent('https://example.github.io/another-project/',{mode:'navigate'});offline.handlers.get('fetch')(sibling);assert.equal(sibling.promise,null);
});
