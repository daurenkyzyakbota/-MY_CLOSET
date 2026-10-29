import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, validateState, outfitStatus } from '../lib/model.js';
import { createClosetController, putItem, putOutfit, putPlan, putShopping } from '../lib/closet-state.js';
import { createBrowserStorage, removeLegacyWorker } from '../lib/storage.js';
import { compressPhoto } from '../lib/photos.js';
import { GET as citiesGET } from '../app/api/cities/route.js';
import { GET as weatherGET } from '../app/api/weather/route.js';

const item = (changes={}) => ({name:'Рубашка',category:'top',colors:['white'],seasons:['summer'],...changes});
const deferred = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };

test('controller is not ready before storage read and migrates without changing original data',async()=>{
  const gate=deferred(),writes=[];const original={version:1,profile:{name:'Амина',city:'',styles:'',colors:[]},items:[],outfits:[],plans:[]};
  const controller=createClosetController({load:()=>gate.promise,save:async value=>writes.push(value)});
  const initialization=controller.initialize();assert.equal(controller.snapshot().ready,false);gate.resolve(original);await initialization;
  assert.equal(controller.snapshot().ready,true);assert.equal(controller.snapshot().state.version,5);assert.equal(original.version,1);assert.equal(writes.length,0);
});

test('queued writes use the latest state and publish only after persistence completes',async()=>{
  const gate=deferred();let calls=0;const writes=[];
  const controller=createClosetController({load:async()=>undefined,save:async value=>{writes.push(structuredClone(value));if(calls++===0)await gate.promise;}});await controller.initialize();
  const first=controller.update(state=>putItem(state,item({id:'first'}))&&state);const second=controller.update(state=>putItem(state,item({id:'second'}))&&state);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(controller.snapshot().state.items.length,0);assert.equal(writes.length,1);gate.resolve();await Promise.all([first,second]);
  assert.deepEqual(controller.snapshot().state.items.map(item=>item.id),['first','second']);assert.deepEqual(writes[1].items.map(item=>item.id),['first','second']);
});

test('failed persistence and invalid mutations leave prior state intact without poisoning later writes',async()=>{
  let fail=true;const writes=[];const controller=createClosetController({load:async()=>undefined,save:async value=>{if(fail)throw new Error('Disk full');writes.push(value);}});await controller.initialize();
  await assert.rejects(controller.update(state=>{putItem(state,item({id:'failed'}));}),/Disk full/);assert.equal(controller.snapshot().state.items.length,0);
  fail=false;await assert.rejects(controller.update(state=>{putItem(state,item({colors:[]}));}));assert.equal(writes.length,0);
  await controller.update(state=>{putItem(state,item({id:'saved'}));});assert.equal(controller.snapshot().state.items[0].id,'saved');assert.equal(writes.length,1);
});

test('damaged or unavailable storage remains untouched; memory edits are labelled and explicit reset can recover',async()=>{
  for(const raw of [null,{version:4,bad:true}]){
    const writes=[];const controller=createClosetController({load:async()=>raw,save:async value=>writes.push(value)});await controller.initialize();assert.equal(controller.snapshot().storageMode,'memory');assert.match(controller.snapshot().error,/не заменена/);
    await controller.update(state=>{putItem(state,item());});assert.equal(writes.length,0);await controller.reset();assert.equal(writes.length,1);assert.equal(controller.snapshot().storageMode,'persistent');assert.equal(controller.snapshot().state.items.length,0);
  }
});

test('purchase-to-garment conversion commits both records atomically and rejects duplicate conversion',async()=>{
  const initial=emptyState();putShopping(initial,{id:'wish',name:'Рубашка',category:'top'});const writes=[];const controller=createClosetController({load:async()=>validateState(initial),save:async value=>writes.push(value)});await controller.initialize();
  await controller.update(state=>{putItem(state,item({id:'garment',shoppingId:'wish'}));});const snapshot=controller.snapshot().state;assert.equal(writes.length,1);assert.equal(snapshot.items[0].id,'garment');assert.equal(snapshot.shoppingList[0].itemId,'garment');assert.equal(snapshot.shoppingList[0].status,'purchased');assert.ok(!Object.hasOwn(snapshot.items[0],'shoppingId'));
  await assert.rejects(controller.update(state=>{putItem(state,item({id:'duplicate',shoppingId:'wish'}));}));assert.equal(controller.snapshot().state.items.length,1);assert.equal(writes.length,1);
});

test('outfit references stay visible after garment deletion, and plan upserts preserve other slots',()=>{
  const state=emptyState();putItem(state,item({id:'shirt'}));putOutfit(state,{id:'look',name:'Образ',itemIds:['shirt']});putPlan(state,{id:'day',date:'2026-10-30',slot:'day',outfitId:'look'});putPlan(state,{id:'evening',date:'2026-10-30',slot:'evening',outfitId:'look'});putPlan(state,{id:'day',date:'2026-10-30',slot:'day',outfitId:'look'});assert.equal(state.plans.length,2);
  const prior=structuredClone(state.plans);assert.throws(()=>putPlan(state,{date:'2026-10-30',slot:'day',outfitId:'look'}),/уже назначен/);assert.deepEqual(state.plans,prior);
  state.items=[];assert.doesNotThrow(()=>validateState(state));assert.deepEqual(outfitStatus(state.outfits[0],[]).missing,['shirt']);
});

test('browser storage retains the existing database/store/key and waits for transaction completion',async()=>{
  let record,completion;const events=[];const database={objectStoreNames:{contains:name=>name==='data'},close(){},transaction(store,mode){events.push([store,mode]);const tx={objectStore:()=>({get(key){events.push(['get',key]);const request={};queueMicrotask(()=>{request.result=record;request.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());});return request;},put(value,key){events.push(['put',key]);completion=()=>{record=value;tx.oncomplete();};}})};return tx;}};
  const indexedDB={open(name,version){events.push([name,version]);const request={};queueMicrotask(()=>{request.result=database;request.onsuccess();});return request;}};
  const storage=createBrowserStorage({indexedDB});assert.equal(await storage.load(),undefined);let finished=false;const saving=storage.save({version:4}).then(()=>{finished=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);completion();await saving;assert.equal(finished,true);assert.deepEqual(events[0],['mycloset-local-v1',1]);assert.ok(events.some(entry=>entry[0]==='put'&&entry[1]==='state'));storage.close();
});

test('legacy cleanup unregisters only the old root MyCloset worker and removes only its cache prefix',async()=>{
  const previous=globalThis.location;globalThis.location={origin:'https://example.test'};const removed=[],unregistered=[];
  try{const registrations=[{scope:'https://example.test/',active:{scriptURL:'https://example.test/sw.js'},unregister:async()=>unregistered.push('closet')},{scope:'https://example.test/other/',active:{scriptURL:'https://example.test/other/sw.js'},unregister:async()=>unregistered.push('other')},{scope:'https://example.test/',active:{scriptURL:'https://example.test/another-worker.js'},unregister:async()=>unregistered.push('unknown')}];await removeLegacyWorker({serviceWorker:{getRegistrations:async()=>registrations}},{keys:async()=>['mycloset-shell-v4','other-app-cache'],delete:async name=>removed.push(name)});assert.deepEqual(unregistered,['closet']);assert.deepEqual(removed,['mycloset-shell-v4']);}finally{globalThis.location=previous;}
});

test('photo rejection happens before browser APIs for unsafe types and oversized originals',async()=>{
  await assert.rejects(compressPhoto({type:'image/svg+xml',size:100}),/JPEG/);await assert.rejects(compressPhoto({type:'image/png',size:13*1024*1024}),/12 МБ/);
});

test('Next route handlers reject malformed input before any upstream request',async()=>{
  const city=await citiesGET(new Request('http://localhost/api/cities?q=x'));assert.equal(city.status,400);assert.equal(city.headers.get('cache-control'),'no-store');assert.match((await city.json()).error,/город/);
  const weather=await weatherGET(new Request('http://localhost/api/weather?lat=https://evil.test&lon=0'));assert.equal(weather.status,400);assert.match((await weather.json()).error,/город/);
});
