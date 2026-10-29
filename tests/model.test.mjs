import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMAT_VERSION,SUBCATEGORIES,CATEGORIES,emptyState,validateState,filterItems,sortItems,categoryCounts,demoState} from '../lib/model.js';

const CREATED='2026-10-27T12:00:00.000Z';
const metadata={subcategory:'',material:'',brand:'',notes:'',purchaseDate:''};
const item=(id='shirt',changes={})=>({id,name:'Белая рубашка',category:'top',colors:['white'],seasons:['spring','autumn'],size:'M',style:'Классический',favorite:false,available:true,photo:'',createdAt:CREATED,warmth:'unknown',rainproof:'unknown',...metadata,...changes});
const missing=()=>({id:'missing-shoes',name:'Лоферы',category:'shoes',colors:[],season:'autumn',style:'classic',size:'38',reason:'Для дополнения комплекта'});
const state=()=>({...emptyState(),profile:{...emptyState().profile,name:'Амина',city:'Кызылорда'},items:[item()],outfits:[{id:'look',name:'Учёба',itemIds:['shirt'],favorite:true,createdAt:CREATED,occasion:'study',style:'classic',season:'autumn',description:'Описание',missingItems:[missing()]}],plans:[{id:'plan',date:'2026-10-27',slot:'day',outfitId:'look'}],shoppingList:[{id:'wish',name:'Лоферы',category:'shoes',colors:['black'],season:'autumn',style:'classic',size:'38',budget:18000,notes:'К образу',status:'planned',itemId:'',createdAt:CREATED}]});
const previous=version=>{const s=state();s.version=version;for(const key of ['wearLog','capsules','trips'])delete s[key];for(const i of s.items)for(const key of Object.keys(metadata))delete i[key];if(version<3){delete s.shoppingList;for(const o of s.outfits)delete o.missingItems;}if(version===1){delete s.profile.location;for(const i of s.items){delete i.warmth;delete i.rainproof;}for(const o of s.outfits)for(const key of ['occasion','style','season','description'])delete o[key];}return s;};

test('v1/v2/v3 migrate to v5 independently and preserve all old personal data',()=>{
  assert.equal(FORMAT_VERSION,5);
  for(const version of [1,2,3]){
    const original=previous(version);original.items[0].photo='data:image/png;base64,iVBORw0KGgo=';const s=validateState(original);
    assert.equal(s.version,5);assert.equal(original.version,version);assert.equal(s.profile.name,'Амина');assert.equal(s.profile.city,'Кызылорда');assert.equal(s.items[0].id,'shirt');assert.equal(s.items[0].photo,original.items[0].photo);assert.deepEqual(s.plans,original.plans);assert.equal(s.outfits[0].favorite,true);
    for(const key of Object.keys(metadata)){assert.equal(s.items[0][key],'');assert.ok(!Object.hasOwn(original.items[0],key));}
    if(version===3){assert.deepEqual(s.shoppingList,original.shoppingList);assert.deepEqual(s.outfits[0].missingItems,original.outfits[0].missingItems);}else{assert.deepEqual(s.shoppingList,[]);assert.deepEqual(s.outfits[0].missingItems,[]);}
    assert.deepEqual(validateState(s),s);
  }
});

test('older schemas reject v4 metadata and corrupt v3 shopping instead of losing it',()=>{
  for(const version of [1,2,3])for(const key of Object.keys(metadata)){const s=previous(version);s.items[0][key]='';assert.throws(()=>validateState(s));}
  const corrupt=previous(3);corrupt.shoppingList[0].budget=-1;assert.throws(()=>validateState(corrupt));
  const missing=previous(3);delete missing.shoppingList;assert.throws(()=>validateState(missing));
  const future=state();future.version=6;assert.throws(()=>validateState(future));
});

test('all optional clothing details survive an exact independent backup round trip',()=>{
  const s=state();Object.assign(s.items[0],{subcategory:'shirt',material:'Хлопок 100%',brand:'Личный бренд',notes:'Подарок. Стирать при 30 °C.',purchaseDate:'2024-02-29'});
  const copy=validateState(s);assert.deepEqual(copy,s);copy.items[0].notes='Другая заметка';assert.notEqual(copy.items[0].notes,s.items[0].notes);
  const sparse=state();for(const key of Object.keys(metadata))delete sparse.items[0][key];for(const key of Object.keys(metadata))assert.equal(validateState(sparse).items[0][key],'');
});

test('subcategory must belong to its parent category, with an empty value accepted everywhere',()=>{
  assert.deepEqual(Object.keys(SUBCATEGORIES),Object.keys(CATEGORIES));
  for(const [category,options] of Object.entries(SUBCATEGORIES)){
    const s=state();s.items[0].category=category;for(const key of ['',...Object.keys(options)]){s.items[0].subcategory=key;assert.doesNotThrow(()=>validateState(s));}
    const otherCategory=Object.keys(SUBCATEGORIES).find(other=>other!==category);const otherKey=Object.keys(SUBCATEGORIES[otherCategory]).find(key=>!Object.hasOwn(options,key));s.items[0].subcategory=otherKey;assert.throws(()=>validateState(s));
  }
  for(const value of ['unknown',null,[],['shirt'],42]){const s=state();s.items[0].subcategory=value;assert.throws(()=>validateState(s));}
});

test('metadata validates text limits and real purchase dates without rejecting empty or leap-day values',()=>{
  for(const [key,max] of [['material',100],['brand',100],['notes',1000]]){
    const s=state();s.items[0][key]='я'.repeat(max);assert.doesNotThrow(()=>validateState(s));s.items[0][key]+='я';assert.throws(()=>validateState(s));s.items[0][key]=null;assert.throws(()=>validateState(s));
  }
  for(const date of ['', '2024-02-29','1900-01-01','2200-12-31']){const s=state();s.items[0].purchaseDate=date;assert.doesNotThrow(()=>validateState(s));}
  for(const date of ['2026-02-29','2026-02-30','2026-13-01','2026-1-01','1899-12-31','2201-01-01','27.10.2026',null,[],123]){const s=state();s.items[0].purchaseDate=date;assert.throws(()=>validateState(s));}
});

test('search finds brand, material, notes and human-readable subcategories alongside existing fields',()=>{
  const items=[item('details',{subcategory:'shirt',brand:'Amina Studio',material:'Лён',notes:'Для защиты проекта'}),item('other',{name:'Куртка',category:'outerwear',subcategory:'jacket',colors:['blue'],style:'Спортивный'})];
  for(const query of ['  AMINA STUDIO ','лён','защиты','рубашка','КЛАССИЧЕСКИЙ','белый'])assert.deepEqual(filterItems(items,{query}).map(i=>i.id),['details']);
  assert.deepEqual(filterItems(items,{query:'куртка'}).map(i=>i.id),['other']);
});

test('style filter is case-insensitive, trimmed, composable and independent of general search',()=>{
  const items=[item('favorite',{favorite:true,style:'Классический, минимализм'}),item('dirty',{style:'Классический',available:false}),item('sport',{style:'Спортивный',colors:['blue']})];
  assert.deepEqual(filterItems(items,{style:' КЛАСС ',category:'top',season:'autumn',color:'white',favorites:true,availability:'available'}).map(i=>i.id),['favorite']);
  assert.deepEqual(filterItems(items,{style:'спорт'}).map(i=>i.id),['sport']);assert.equal(filterItems(items,{style:'   '}).length,3);assert.deepEqual(filterItems(items,{style:'класс',query:'минимализм'}).map(i=>i.id),['favorite']);
});

test('sort modes preserve source order and use deterministic ID ties',()=>{
  const items=[item('z',{name:'Яблоко',createdAt:'2026-10-26T12:00:00.000Z'}),item('b',{name:'Блуза',favorite:true}),item('a',{name:'Блуза',favorite:true}),item('c',{name:'Артикул 10',createdAt:'2026-10-25T12:00:00.000Z'}),item('d',{name:'Артикул 2',createdAt:'2026-10-25T12:00:00.000Z'})];
  const originalIds=items.map(i=>i.id);
  assert.deepEqual(sortItems(items).map(i=>i.id),['a','b','z','c','d']);assert.deepEqual(sortItems(items,'oldest').map(i=>i.id),['c','d','z','a','b']);assert.deepEqual(sortItems(items,'name').map(i=>i.id),['d','c','a','b','z']);assert.deepEqual(sortItems(items,'favorites').map(i=>i.id),['a','b','z','c','d']);assert.deepEqual(sortItems(items,'unknown').map(i=>i.id),sortItems(items).map(i=>i.id));assert.deepEqual(items.map(i=>i.id),originalIds);assert.notEqual(sortItems(items),items);
});

test('category counts include all six categories and exclude unknown categories without mutating inputs',()=>{
  const items=[item(),item('second'),item('shoe',{category:'shoes'}),item('unknown',{category:'not-a-category'})];assert.deepEqual(categoryCounts(items),{top:2,bottom:0,dress:0,outerwear:0,shoes:1,accessory:0});assert.deepEqual(categoryCounts([]),{top:0,bottom:0,dress:0,outerwear:0,shoes:0,accessory:0});assert.equal(items.length,4);
});

test('demo preserves v3 shopping and missing-item records when adding examples',()=>{
  const original=previous(3);const demo=demoState(original);assert.equal(demo.version,5);assert.equal(demo.items.length,7);assert.deepEqual(demo.shoppingList,original.shoppingList);assert.deepEqual(demo.outfits[0].missingItems,original.outfits[0].missingItems);assert.deepEqual(demo.plans,original.plans);assert.doesNotThrow(()=>validateState(demo));
});
