import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMAT_VERSION,emptyState,validateState,outfitStatus,demoState} from '../model.mjs';
import {recommendOutfits} from '../stylist.mjs';
import {shoppingDraftFromMissing,createStoreSearchLinks,buildMissingRecommendations} from '../shopping.mjs';

const CREATED='2026-10-23T12:00:00.000Z';
const item=(id='top',category='top',changes={})=>({id,name:'Базовая вещь',category,colors:['white'],seasons:['spring','summer','autumn','winter'],size:'M',style:'Повседневный',favorite:false,available:true,photo:'',createdAt:CREATED,warmth:'unknown',rainproof:'unknown',subcategory:'',material:'',brand:'',notes:'',purchaseDate:'',...changes});
const missing=(changes={})=>({id:'missing',name:'Прямые брюки',category:'bottom',colors:['beige'],season:'autumn',style:'minimal',size:'M',reason:'Для дополнения образа',...changes});
const outfit=(changes={})=>({id:'look',name:'Мой образ',itemIds:['top'],favorite:true,createdAt:CREATED,occasion:'study',style:'minimal',season:'autumn',description:'Описание',missingItems:[],...changes});
const state=()=>({...emptyState(),items:[item()],outfits:[outfit()],plans:[{id:'plan',date:'2026-10-23',slot:'day',outfitId:'look'}]});
const wardrobe=()=>[item('top','top'),item('bottom','bottom'),item('shoes','shoes')];
const v2=()=>{const s=state();s.version=2;for(const i of s.items)for(const key of ['subcategory','material','brand','notes','purchaseDate'])delete i[key];delete s.shoppingList;delete s.outfits[0].missingItems;return s;};
const v1=()=>{const s=v2();s.version=1;delete s.profile.location;for(const i of s.items){delete i.warmth;delete i.rainproof;}for(const o of s.outfits)for(const key of ['occasion','style','season','description'])delete o[key];return s;};
const warm={feelsLike:22,rainProbability:0,windSpeed:2};
const cold={feelsLike:3,rainProbability:0,windSpeed:2};
const message=r=>[...r.warnings,...r.outfits.flatMap(o=>o.warnings)].join(' ');

test('strict v1 and v2 migrate independently to v3 without losing IDs, photos, favorites or plans',()=>{
  assert.equal(FORMAT_VERSION,4);
  for(const original of [v1(),v2()]){
    original.items[0].photo='data:image/png;base64,iVBORw0KGgo=';
    const copy=validateState(original);assert.equal(copy.version,4);assert.deepEqual(copy.shoppingList,[]);assert.deepEqual(copy.outfits[0].missingItems,[]);
    assert.equal(copy.items[0].id,'top');assert.equal(copy.items[0].photo,original.items[0].photo);assert.equal(copy.outfits[0].favorite,true);assert.deepEqual(copy.plans,original.plans);
    assert.ok(!Object.hasOwn(original,'shoppingList'));assert.ok(!Object.hasOwn(original.outfits[0],'missingItems'));
    assert.deepEqual(validateState(copy),copy);
  }
});

test('old versions reject new shopping fields instead of silently discarding them',()=>{
  for(const build of [v1,v2])for(const mutate of [s=>s.shoppingList=[],s=>s.outfits[0].missingItems=[],s=>s.items[0].surprise=true,s=>delete s.items[0].name]){
    const candidate=build();mutate(candidate);assert.throws(()=>validateState(candidate));
  }
  const candidate=state();delete candidate.shoppingList;assert.throws(()=>validateState(candidate));
});

test('v3 allows missing-only saved ideas, defaults omitted missingItems and caps combined composition',()=>{
  const candidate=state();candidate.outfits[0]=outfit({itemIds:[],missingItems:[missing()]});assert.doesNotThrow(()=>validateState(candidate));
  candidate.outfits[0].missingItems=[];assert.throws(()=>validateState(candidate));
  candidate.outfits[0]=outfit();delete candidate.outfits[0].missingItems;assert.deepEqual(validateState(candidate).outfits[0].missingItems,[]);
  candidate.outfits[0]=outfit({itemIds:Array.from({length:25},(_,i)=>'owned'+i),missingItems:Array.from({length:6},(_,i)=>missing({id:'m'+i}))});assert.throws(()=>validateState(candidate));
  candidate.outfits[0]=outfit({missingItems:Array.from({length:11},(_,i)=>missing({id:'m'+i}))});assert.throws(()=>validateState(candidate));
});

test('missing-item validation rejects duplicate and crossing IDs, unknown fields and malformed enums',()=>{
  const mutations=[m=>m.id='../bad',m=>m.name='',m=>m.category='imaginary',m=>m.category=['bottom'],m=>m.colors=['fake'],m=>m.colors=['white','white'],m=>m.colors=[['white']],m=>m.season='monsoon',m=>m.style='s'.repeat(101),m=>m.size='s'.repeat(31),m=>m.reason='x'.repeat(501),m=>m.extra=true];
  for(const mutate of mutations){const s=state();const m=missing();mutate(m);s.outfits[0].missingItems=[m];assert.throws(()=>validateState(s));}
  for(const entries of [[missing(),missing()],[missing({id:'top'})]]){const s=state();s.outfits[0].missingItems=entries;assert.throws(()=>validateState(s));}
  const s=state();s.outfits[0].missingItems=[missing({colors:[],season:'',style:'',size:'',reason:''})];assert.doesNotThrow(()=>validateState(s));
});

test('shopping drafts are independent, have user budget defaults and survive exact backup round trip',()=>{
  const source=missing();const draft=shoppingDraftFromMissing(source);assert.notEqual(draft.id,source.id);assert.equal(draft.budget,null);assert.equal(draft.status,'planned');assert.equal(draft.itemId,'');assert.equal(draft.notes,source.reason);
  draft.colors.push('black');assert.deepEqual(source.colors,['beige']);
  const s=state();s.shoppingList=[draft];assert.deepEqual(validateState(s),s);
  const changed=shoppingDraftFromMissing(source,{budget:12500,status:'purchased',itemId:'top'});s.shoppingList=[changed];assert.doesNotThrow(()=>validateState(s));
});

test('shopping validates budgets, statuses, text, IDs, dates, lists and strict shape',()=>{
  const mutations=[d=>d.budget=-1,d=>d.budget=Infinity,d=>d.budget='1000',d=>d.budget=100000001,d=>d.status='ordered',d=>d.status=['planned'],d=>d.itemId=null,d=>d.itemId='../bad',d=>d.notes='x'.repeat(501),d=>d.createdAt='2026-02-30T12:00:00.000Z',d=>d.category='fake',d=>d.surprise=true,d=>delete d.size];
  for(const mutate of mutations){const s=state();const d=shoppingDraftFromMissing(missing());mutate(d);s.shoppingList=[d];assert.throws(()=>validateState(s));}
  for(const budget of [null,0,100000000,12.5]){const s=state();s.shoppingList=[shoppingDraftFromMissing(missing(),{budget})];assert.doesNotThrow(()=>validateState(s));}
  const s=state();const draft=shoppingDraftFromMissing(missing());s.shoppingList=[draft,{...draft}];assert.throws(()=>validateState(s));
  s.shoppingList=Array.from({length:501},(_,i)=>({...draft,id:'s'+i}));assert.throws(()=>validateState(s));
});

test('outfitStatus keeps its public four-key shape and marks missing proposals incomplete',()=>{
  const s=state();const result=outfitStatus(outfit({missingItems:[missing()]}),s.items);assert.deepEqual(Object.keys(result).sort(),['complete','items','missing','unavailable']);assert.equal(result.complete,false);assert.deepEqual(result.missing,[]);
  assert.equal(outfitStatus(outfit(),s.items).complete,true);assert.deepEqual(outfitStatus(outfit(),[]).missing,['top']);assert.deepEqual(outfitStatus(outfit(),[item('top','top',{available:false})]).unavailable,['top']);
});

test('full owned outfits always win and never produce a purchase recommendation',()=>{
  const items=wardrobe();const full=recommendOutfits(items,{weather:warm});assert.ok(full.outfits.length);assert.deepEqual(buildMissingRecommendations(items,{weather:warm},full),{outfits:[],warnings:[]});assert.deepEqual(buildMissingRecommendations(items,{weather:warm}),{outfits:[],warnings:[]});
});

test('partial ideas preserve real owned items and recommend only genuinely absent categories',()=>{
  const items=wardrobe().filter(i=>i.category!=='bottom');const r=buildMissingRecommendations(items,{weather:warm,anchorItemId:'top',season:'autumn'});assert.ok(r.outfits.length);
  for(const o of r.outfits){assert.equal(o.complete,false);assert.ok(o.itemIds.includes('top'));assert.ok(o.itemIds.every(id=>items.some(i=>i.id===id)));assert.deepEqual(o.missingItems.map(m=>m.category),['bottom']);assert.ok(!o.itemIds.includes(o.missingItems[0].id));assert.match(o.warnings.join(' '),/не принадлежат/);assert.ok(o.missingItems[0].reason.length<=500);}
  const s=state();s.items=items;s.outfits=r.outfits.map((r,i)=>outfit({id:'partial'+i,name:r.title,itemIds:r.itemIds,missingItems:r.missingItems,description:r.description}));s.plans=[];assert.doesNotThrow(()=>validateState(s));
});

test('one base is chosen: dress plus shoes does not also demand a top and bottom',()=>{
  const r=buildMissingRecommendations([item('shoes','shoes')],{weather:warm});assert.ok(r.outfits.length);assert.deepEqual(r.outfits[0].missingItems.map(m=>m.category),['dress']);
  const dress=buildMissingRecommendations([item('dress','dress')],{weather:warm,anchorItemId:'dress'});assert.deepEqual(dress.outfits[0].missingItems.map(m=>m.category),['shoes']);
});

test('empty or entirely unavailable wardrobes never generate synthetic-owned outfits',()=>{
  const empty=buildMissingRecommendations([],{weather:warm});assert.deepEqual(empty.outfits,[]);assert.match(message(empty),/добавьте/);
  const dirty=buildMissingRecommendations([item('top','top',{available:false})],{weather:warm});assert.deepEqual(dirty.outfits,[]);assert.match(message(dirty),/стирке/);
});

test('laundry does not cause buying an alternative dress or a duplicate category',()=>{
  for(const category of ['top','bottom','shoes']){
    const items=wardrobe().map(i=>i.category===category?{...i,available:false}:i);const r=buildMissingRecommendations(items,{weather:warm});assert.equal(r.outfits.length,0);assert.match(message(r),/стирке/);
  }
  const items=wardrobe().filter(i=>i.category!=='shoes').map(i=>i.category==='top'?{...i,available:false}:i);assert.equal(buildMissingRecommendations(items,{weather:warm}).outfits.length,0);
});

test('owned but season/weather-ineligible categories advise changing conditions, not purchases',()=>{
  const summerOnly=wardrobe().map(i=>i.category==='top'?{...i,seasons:['summer']}:i);const season=buildMissingRecommendations(summerOnly,{season:'winter',weather:warm});assert.equal(season.outfits.length,0);assert.match(message(season),/сезон/);
  const tooWarm=wardrobe().map(i=>i.category==='top'?{...i,warmth:'warm'}:i);const heat=buildMissingRecommendations(tooWarm,{weather:{...warm,feelsLike:30}});assert.equal(heat.outfits.length,0);assert.match(message(heat),/погод/);
  const coldCoat=[...wardrobe(),item('coat','outerwear',{warmth:'light'})];const weather=buildMissingRecommendations(coldCoat,{weather:cold});assert.equal(weather.outfits.length,0);assert.match(message(weather),/погод/);
});

test('missing cold-weather coat is a transparent placeholder with weather requirements',()=>{
  const r=buildMissingRecommendations(wardrobe(),{weather:{...cold,rainProbability:85,windSpeed:14}});assert.ok(r.outfits.length);assert.deepEqual(r.outfits[0].missingItems.map(m=>m.category),['outerwear']);assert.match(r.outfits[0].missingItems[0].reason,/тёплая/);assert.match(r.outfits[0].missingItems[0].reason,/дождя/);assert.match(message(r),/Сильный ветер/);
});

test('unusable anchors are never silently discarded by missing recommendations',()=>{
  const items=[item('top','top'),item('dirty','top',{available:false}),item('winter','top',{seasons:['winter']})];
  for(const options of [{anchorItemId:'missing'},{anchorItemId:'dirty'},{anchorItemId:'winter',season:'summer'}]){const r=buildMissingRecommendations(items,options);assert.equal(r.outfits.length,0);assert.match(message(r),/Выбранная вещь/);}
});

test('partial proposals stay distinct and bounded and preserve optional accessory anchors',()=>{
  const items=[item('top1','top'),item('top2','top'),item('top3','top'),item('top4','top'),item('bag','accessory'),item('shoes','shoes')];const r=buildMissingRecommendations(items,{weather:warm,anchorItemId:'bag',limit:3});assert.ok(r.outfits.length>=1);assert.ok(r.outfits.length<=3);assert.ok(r.outfits.every(o=>o.itemIds.includes('bag')));const signatures=r.outfits.map(o=>o.itemIds.join('|')+o.missingItems.map(m=>m.category).join('|'));assert.equal(new Set(signatures).size,signatures.length);
});

test('verified search links use fixed official hosts and encode hostile names as query data',()=>{
  const draft=shoppingDraftFromMissing(missing({name:'Брюки & https://evil.example/?x=<script> " шёлк',style:'minimal',size:'M'}),{budget:999999});const links=createStoreSearchLinks(draft);assert.equal(links.length,2);assert.deepEqual(links.map(l=>Object.keys(l).sort()),[['id','name','url'],['id','name','url']]);
  for(const link of links){const url=new URL(link.url);assert.equal(url.protocol,'https:');assert.ok(['kaspi.kz','www.lamoda.kz'].includes(url.hostname));const query=url.searchParams.get(link.id==='kaspi'?'text':'q');assert.match(query,/https:\/\/evil.example/);assert.ok(!query.includes('999999'));assert.ok(query.length<=160);assert.equal(url.username,'');}
  assert.deepEqual(createStoreSearchLinks({name:' ',category:'invalid'}),[]);
  assert.ok(new URL(createStoreSearchLinks({...draft,name:'x'.repeat(1000)})[0].url).searchParams.get('text').length<=160);
});

test('existing demo data and all photo/date/duplicate validations still apply in v3',()=>{
  const demo=demoState();assert.equal(demo.version,4);assert.equal(demo.items.length,6);assert.deepEqual(demo.shoppingList,[]);assert.doesNotThrow(()=>validateState(demo));
  for(const mutate of [s=>s.items[0].photo='data:image/svg+xml;base64,PHN2Zz4=',s=>s.items[0].photo='https://example.com/a.png',s=>s.items.push({...s.items[0]}),s=>s.items[0].createdAt='2026-02-30T12:00:00.000Z',s=>s.plans[0].date='2026-02-29',s=>s.plans[0].outfitId='absent',s=>s.plans.push({...s.plans[0],id:'another'})]){const s=state();mutate(s);assert.throws(()=>validateState(s));}
});
