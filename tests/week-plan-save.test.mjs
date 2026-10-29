import test from 'node:test';
import assert from 'node:assert/strict';
import { demoState, emptyState } from '../lib/model.js';
import { createClosetController } from '../lib/closet-state.js';
import { applyWeekPlans } from '../lib/week-plan-save.js';
const today='2026-10-30';
function fixture(){const state=demoState(emptyState());const outfit=state.outfits[0];state.outfits=[];return{state,outfit};}

test('a week saves its outfits and plans in one persisted operation, reusing matching compositions',async()=>{
 const {state,outfit}=fixture();let writes=0;const controller=createClosetController({load:async()=>state,save:async()=>{writes++;}});await controller.initialize();
 await controller.update(draft=>{applyWeekPlans(draft,[{date:today,slot:'day',outfit},{date:'2026-10-31',slot:'day',outfit}],today);});
 const next=controller.snapshot().state;assert.equal(next.plans.length,2);assert.equal(next.outfits.length,1);assert.equal(next.plans[0].outfitId,next.plans[1].outfitId);assert.equal(writes,1);
});
test('an occupied slot rejects the whole week and never replaces an existing calendar plan',async()=>{
 const {state,outfit}=fixture();state.outfits=[outfit];state.plans=[{id:'existing-plan',date:'2026-10-31',slot:'day',outfitId:outfit.id}];let writes=0;const controller=createClosetController({load:async()=>state,save:async()=>{writes++;}});await controller.initialize();const before=structuredClone(controller.snapshot().state);
 await assert.rejects(controller.update(draft=>{applyWeekPlans(draft,[{date:today,slot:'day',outfit},{date:'2026-10-31',slot:'day',outfit}],today);}),/уже занят/);assert.deepEqual(controller.snapshot().state,before);assert.equal(writes,0);
});
test('a garment sent to laundry after preview prevents saving without creating unused outfits',async()=>{
 const {state,outfit}=fixture();state.items.find(item=>item.id===outfit.itemIds[0]).available=false;const controller=createClosetController({load:async()=>state,save:async()=>assert.fail('No write expected')});await controller.initialize();const before=structuredClone(controller.snapshot().state);
 await assert.rejects(controller.update(draft=>{applyWeekPlans(draft,[{date:today,slot:'day',outfit}],today);}),/доступность/);assert.deepEqual(controller.snapshot().state,before);
});
