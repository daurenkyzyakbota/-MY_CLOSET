import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_BACKUP_FILE_BYTES,MAX_WEAR_RECORDS,MAX_WEAR_REFERENCES,MAX_CAPSULES,MAX_TRIPS,COLORS,SEASONS,emptyState,validateState,localDate} from '../lib/model.js';

test('import byte limit accepts maximum legal v5 export with all collection limits and six-byte JSON escapes',()=>{
  const escaped=length=>'\0'.repeat(length);
  const id=(prefix,index)=>`${prefix}${index}`.padEnd(100,'x');
  const createdAt='+275760-09-13T00:00:00.000Z';
  const colors=Object.keys(COLORS);
  const state=emptyState();
  state.profile={name:escaped(80),city:escaped(120),styles:escaped(200),colors:[...colors],location:{id:id('city',0),name:escaped(120),country:escaped(100),admin1:escaped(120),latitude:-89.99999999999999,longitude:-179.99999999999997,timezone:'America/Argentina/ComodRivadavia'}};
  const photoPrefix='data:image/jpeg;base64,';
  const photo=photoPrefix+'A'.repeat(100000-photoPrefix.length);
  state.items=Array.from({length:500},(_,index)=>({id:id('garment',index),name:escaped(100),category:'outerwear',subcategory:'down_jacket',material:escaped(100),brand:escaped(100),notes:escaped(1000),purchaseDate:'2200-12-31',colors:[...colors],seasons:Object.keys(SEASONS),size:escaped(30),style:escaped(100),favorite:false,available:false,photo,createdAt,warmth:'unknown',rainproof:'unknown'}));
  const ownedIds=state.items.slice(0,20).map(item=>item.id);
  const missingItems=Array.from({length:10},(_,index)=>({id:id('missing',index),name:escaped(100),category:'accessory',colors:[...colors],season:'spring',style:escaped(100),size:escaped(30),reason:escaped(500)}));
  state.outfits=Array.from({length:500},(_,index)=>({id:id('outfit',index),name:escaped(100),itemIds:[...ownedIds],favorite:false,createdAt,occasion:'everyday',style:escaped(100),season:'spring',description:escaped(500),missingItems:missingItems.map(item=>({...item,colors:[...colors]}))}));
  state.plans=Array.from({length:5000},(_,index)=>({id:id('plan',index),date:localDate(new Date(2026,0,1+index)),slot:'evening',outfitId:state.outfits[index%500].id}));
  state.shoppingList=Array.from({length:500},(_,index)=>({id:id('purchase',index),name:escaped(100),category:'accessory',colors:[...colors],season:'spring',style:escaped(100),size:escaped(30),budget:0.0000010000000000000002,notes:escaped(500),status:'purchased',itemId:state.items[index].id,createdAt}));
  const garmentIds=state.items.map(item=>item.id);
  const outfitIds=state.outfits.map(outfit=>outfit.id);
  state.wearLog=Array.from({length:MAX_WEAR_RECORDS},(_,index)=>({id:id('wear',index),date:localDate(new Date(2026,0,1+index)),itemIds:garmentIds.slice(0,MAX_WEAR_REFERENCES/MAX_WEAR_RECORDS),outfitId:outfitIds[index%500],notes:escaped(500)}));
  state.capsules=Array.from({length:MAX_CAPSULES},(_,index)=>({id:id('capsule',index),name:escaped(100),description:escaped(1000),itemIds:[...garmentIds],outfitIds:[...outfitIds],createdAt}));
  state.trips=Array.from({length:MAX_TRIPS},(_,index)=>({id:id('trip',index),name:escaped(100),destination:escaped(120),startDate:'1900-01-01',endDate:'1900-12-31',itemIds:[...garmentIds],outfitIds:[...outfitIds],packedItemIds:[...garmentIds],notes:escaped(1000),createdAt}));

  assert.equal(state.items.reduce((sum,item)=>sum+item.photo.length,0),50000000);
  assert.equal(state.wearLog.reduce((sum,entry)=>sum+entry.itemIds.length,0),MAX_WEAR_REFERENCES);
  assert.doesNotThrow(()=>validateState(state));
  const bytes=Buffer.byteLength(JSON.stringify(state,null,2),'utf8');
  assert.ok(bytes>55*1024*1024,`Fixture ${bytes} bytes must expose the previous import limit.`);
  assert.ok(bytes<MAX_BACKUP_FILE_BYTES,`Maximum legal export ${bytes} bytes exceeds import limit ${MAX_BACKUP_FILE_BYTES}.`);
  assert.equal(MAX_BACKUP_FILE_BYTES,160*1024*1024);
  console.log(`Maximum escaped v5 fixture: ${bytes} bytes; limit: ${MAX_BACKUP_FILE_BYTES} bytes.`);
});
