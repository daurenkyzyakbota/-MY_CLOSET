import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_BACKUP_FILE_BYTES,COLORS,SEASONS,emptyState,validateState,localDate} from '../model.mjs';

test('import byte limit accepts maximum legal v4 export with six-byte JSON escapes',()=>{
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

  assert.equal(state.items.reduce((sum,item)=>sum+item.photo.length,0),50000000);
  assert.doesNotThrow(()=>validateState(state));
  const bytes=Buffer.byteLength(JSON.stringify(state,null,2),'utf8');
  assert.ok(bytes>55*1024*1024,`Fixture ${bytes} bytes must expose the previous import limit.`);
  assert.ok(bytes<MAX_BACKUP_FILE_BYTES,`Maximum legal export ${bytes} bytes exceeds import limit ${MAX_BACKUP_FILE_BYTES}.`);
  assert.equal(MAX_BACKUP_FILE_BYTES,96*1024*1024);
  console.log(`Maximum escaped v4 fixture: ${bytes} bytes; limit: ${MAX_BACKUP_FILE_BYTES} bytes.`);
});
