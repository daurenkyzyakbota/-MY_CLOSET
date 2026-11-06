import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeWardrobes, conflictLabel, assertMergePreviewCurrent } from '../lib/cloud/cloud-merge.js';
import { emptyState, validateState } from '../lib/data/model.js';
import { itemFromDraft } from '../lib/data/closet-state.js';
import { moveItemsToTrash } from '../lib/data/trash.js';

const state = () => ({ version: 5, profile: { city: '', styles: '', colors: [] }, items: [], outfits: [], plans: [], shoppingList: [], wearLog: [], capsules: [], trips: [], trash: [] });
const variants = (base) => [structuredClone(base), structuredClone(base)];

test('three-way merge combines different records and fields across every collection without changing inputs', () => {
  const base = state();
  for (const collection of ['items', 'outfits', 'plans', 'shoppingList', 'wearLog', 'capsules', 'trips'])
    base[collection] = [{ id: 'a', name: 'Original', photo: 'data:image/png;base64,old' }, { id: 'b', name: 'Second' }];
  const [local, cloud] = variants(base);
  local.profile.city = 'Алматы'; cloud.profile.styles = 'classic';
  for (const collection of ['items', 'outfits', 'plans', 'shoppingList', 'wearLog', 'capsules', 'trips']) {
    local[collection][0].name = 'Local'; cloud[collection][1].name = 'Cloud';
    cloud[collection][0].photo = 'data:image/png;base64,new';
  }
  const originals = structuredClone([base, local, cloud]);
  const result = mergeWardrobes(base, local, cloud);
  assert.equal(result.unresolved, 0);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.snapshot.profile.city, 'Алматы');
  assert.equal(result.snapshot.profile.styles, 'classic');
  for (const collection of ['items', 'outfits', 'plans', 'shoppingList', 'wearLog', 'capsules', 'trips']) {
    assert.equal(result.snapshot[collection][0].name, 'Local');
    assert.equal(result.snapshot[collection][0].photo, 'data:image/png;base64,new');
    assert.equal(result.snapshot[collection][1].name, 'Cloud');
  }
  assert.deepEqual([base, local, cloud], originals);
});

test('concurrent field and photo edits require individual explicit choices', () => {
  const base = state(); base.items = [{ id: 'dress', name: 'Платье', photo: 'old', favorite: false }];
  const [local, cloud] = variants(base);
  Object.assign(local.items[0], { name: 'Красное', photo: 'local', favorite: true });
  Object.assign(cloud.items[0], { name: 'Синее', photo: 'cloud' });
  const preview = mergeWardrobes(base, local, cloud);
  assert.equal(preview.unresolved, 2);
  assert.match(conflictLabel(preview.conflicts[0]), /Вещи.*Платье.*Название/);
  const choices = Object.fromEntries(preview.conflicts.map((conflict) => [conflict.id, conflict.path.at(-1) === 'name' ? 'cloud' : 'local']));
  const approved = mergeWardrobes(base, local, cloud, choices);
  assert.equal(approved.unresolved, 0);
  assert.deepEqual(approved.snapshot.items[0], { id: 'dress', name: 'Синее', photo: 'local', favorite: true });
  assert.equal(mergeWardrobes(base, local, cloud, { [preview.conflicts[0].id]: 'anything' }).unresolved, 2);
});

test('record deletion versus edit is resolved with its trash entry as one operation', () => {
  const base = state(); base.items = [{ id: 'dress', name: 'Платье', photo: 'full-photo' }];
  const [local, cloud] = variants(base);
  local.items = [];
  local.trash.push({ id: 'bin-a', type: 'item', deletedAt: '2026-11-06T10:00:00.000Z', record: base.items[0], plans: [], shoppingIds: [] });
  cloud.items[0].name = 'Новое название';
  const preview = mergeWardrobes(base, local, cloud);
  assert.equal(preview.conflicts.length, 1);
  assert.equal(preview.conflicts[0].kind, 'lifecycle');
  const key = preview.conflicts[0].id;
  const keep = mergeWardrobes(base, local, cloud, { [key]: 'cloud' });
  assert.equal(keep.snapshot.items[0].name, 'Новое название');
  assert.deepEqual(keep.snapshot.trash, []);
  const remove = mergeWardrobes(base, local, cloud, { [key]: 'local' });
  assert.deepEqual(remove.snapshot.items, []);
  assert.equal(remove.snapshot.trash[0].record.photo, 'full-photo');
});

test('restore versus edits in the bin never leaves the record both active and deleted', () => {
  const base = state();
  base.trash = [{ id: 'bin-a', type: 'outfit', deletedAt: '2026-11-06T10:00:00.000Z', record: { id: 'look', name: 'Образ' }, plans: [], shoppingIds: [] }];
  const [local, cloud] = variants(base);
  local.outfits = [structuredClone(base.trash[0].record)]; local.trash = [];
  cloud.trash[0].record.name = 'Изменён в корзине';
  const preview = mergeWardrobes(base, local, cloud);
  assert.equal(preview.unresolved, 1);
  const key = preview.conflicts[0].id;
  const restored = mergeWardrobes(base, local, cloud, { [key]: 'local' });
  assert.equal(restored.snapshot.outfits.length, 1);
  assert.equal(restored.snapshot.trash.length, 0);
  const deleted = mergeWardrobes(base, local, cloud, { [key]: 'cloud' });
  assert.equal(deleted.snapshot.outfits.length, 0);
  assert.equal(deleted.snapshot.trash[0].record.name, 'Изменён в корзине');
});

test('safe additions, unchanged deletions, primitive arrays and explicit null are preserved', () => {
  const base = state(); base.capsules = [{ id: 'remove', name: 'old' }]; base.profile.location = { latitude: 1, longitude: 2 };
  const [local, cloud] = variants(base);
  local.capsules = [{ id: 'new-local', name: 'local' }]; cloud.capsules.push({ id: 'new-cloud', name: 'cloud' });
  local.profile.location = null; cloud.profile.colors = ['blue'];
  const result = mergeWardrobes(base, local, cloud);
  assert.equal(result.unresolved, 0);
  assert.deepEqual(result.snapshot.capsules.map((record) => record.id).sort(), ['new-cloud', 'new-local']);
  assert.equal(result.snapshot.profile.location, null);
  assert.deepEqual(result.snapshot.profile.colors, ['blue']);
});

test('competing record order is an explicit conflict; an independent addition is kept', () => {
  const base = state(); base.trips = ['a', 'b', 'c'].map((id) => ({ id }));
  const [local, cloud] = variants(base);
  local.trips = [local.trips[1], local.trips[0], local.trips[2], { id: 'd' }];
  cloud.trips = [cloud.trips[0], cloud.trips[2], cloud.trips[1]];
  const preview = mergeWardrobes(base, local, cloud);
  assert.equal(preview.unresolved, 1);
  assert.equal(preview.conflicts[0].kind, 'order');
  const approved = mergeWardrobes(base, local, cloud, { [preview.conflicts[0].id]: 'cloud' });
  assert.deepEqual(approved.snapshot.trips.map((entry) => entry.id), ['a', 'c', 'b', 'd']);
});

test('deleting an optional field differs from explicit null and does not mutate source objects', () => {
  const base = state(); base.profile.location = { latitude: 1 };
  const [local, cloud] = variants(base);
  delete local.profile.location; cloud.profile.location = null;
  const preview = mergeWardrobes(base, local, cloud);
  assert.equal(preview.unresolved, 1);
  assert.equal(preview.conflicts[0].localMissing, true);
  const approved = mergeWardrobes(base, local, cloud, { [preview.conflicts[0].id]: 'local' });
  assert.equal(Object.hasOwn(approved.snapshot.profile, 'location'), false);
});

test('concurrent deletion into different bin entries requires one choice and retains only one entry', () => {
  const base = state(); base.items = [{ id: 'dress', name: 'Платье' }];
  const [local, cloud] = variants(base);
  local.items = []; cloud.items = [];
  const deleted = { type: 'item', deletedAt: '2026-11-06T10:00:00.000Z', record: base.items[0], plans: [], shoppingIds: [] };
  local.trash = [{ ...deleted, id: 'deleted-here' }];
  cloud.trash = [{ ...deleted, id: 'deleted-there' }];
  const preview = mergeWardrobes(base, local, cloud);
  assert.equal(preview.conflicts.length, 1);
  assert.equal(preview.conflicts[0].kind, 'lifecycle');
  const saved = mergeWardrobes(base, local, cloud, { [preview.conflicts[0].id]: 'cloud' });
  assert.deepEqual(saved.snapshot.trash.map((entry) => entry.id), ['deleted-there']);
  assert.deepEqual(saved.snapshot.items, []);
});

test('outfit deletion versus a changed calendar plan includes dependent plans in the lifecycle choice', () => {
  const base = state(); base.outfits = [{ id: 'look', name: 'Образ' }];
  base.plans = [{ id: 'plan', outfitId: 'look', date: '2026-11-07', slot: 'day' }];
  const [local, cloud] = variants(base);
  local.outfits = []; local.plans = [];
  local.trash = [{ id: 'bin-look', type: 'outfit', record: base.outfits[0], plans: base.plans, shoppingIds: [] }];
  cloud.plans[0].date = '2026-11-08';
  const preview = mergeWardrobes(base, local, cloud);
  assert.equal(preview.conflicts.length, 1);
  const keep = mergeWardrobes(base, local, cloud, { [preview.conflicts[0].id]: 'cloud' });
  assert.equal(keep.snapshot.outfits.length, 1);
  assert.equal(keep.snapshot.plans[0].date, '2026-11-08');
  assert.equal(keep.snapshot.trash.length, 0);
  const remove = mergeWardrobes(base, local, cloud, { [preview.conflicts[0].id]: 'local' });
  assert.deepEqual(remove.snapshot.plans, []);
  assert.deepEqual(remove.snapshot.outfits, []);
  assert.equal(remove.snapshot.trash[0].plans[0].date, '2026-11-07');
});

test('keeping a garment after conflicting deletion retains purchase links while merging unrelated wish edits', () => {
  const base = state(); base.items = [{ id: 'dress', name: 'Платье' }];
  base.shoppingList = [{ id: 'wish', name: 'Покупка', itemId: 'dress' }];
  const [local, cloud] = variants(base);
  local.items = []; local.shoppingList[0].itemId = '';
  local.trash = [{ id: 'bin-dress', type: 'item', record: base.items[0], plans: [], shoppingIds: ['wish'] }];
  cloud.items[0].name = 'Другое название'; cloud.shoppingList[0].name = 'Изменённая покупка';
  const preview = mergeWardrobes(base, local, cloud);
  const keep = mergeWardrobes(base, local, cloud, { [preview.conflicts[0].id]: 'cloud' });
  assert.equal(keep.snapshot.shoppingList[0].itemId, 'dress');
  assert.equal(keep.snapshot.shoppingList[0].name, 'Изменённая покупка');
});

test('different new calendar IDs at one date and slot produce a semantic choice', () => {
  const base = state(); const [local, cloud] = variants(base);
  local.plans = [{ id: 'here', outfitId: 'first', date: '2026-11-07', slot: 'day' }];
  cloud.plans = [{ id: 'there', outfitId: 'second', date: '2026-11-07', slot: 'day' }];
  const preview = mergeWardrobes(base, local, cloud);
  assert.equal(preview.conflicts.length, 1);
  assert.equal(preview.conflicts[0].kind, 'schedule');
  const selected = mergeWardrobes(base, local, cloud, { [preview.conflicts[0].id]: 'cloud' });
  assert.equal(selected.unresolved, 0);
  assert.deepEqual(selected.snapshot.plans.map((plan) => plan.id), ['there']);
});

test('approval is invalidated by account, local edits or a newer cloud revision', () => {
  const preview = { userId: 'alice', base: state(), cloud: state(), localHash: 'local-at-preview', revision: 5 };
  const current = { userId: 'alice', localHash: 'local-at-preview', revision: 5 };
  assert.doesNotThrow(() => assertMergePreviewCurrent(preview, current));
  assert.throws(() => assertMergePreviewCurrent(preview, { ...current, userId: 'bob' }), (error) => error.status === 409 && error.code === 'MERGE_PREVIEW_REQUIRED');
  assert.throws(() => assertMergePreviewCurrent(preview, { ...current, localHash: 'new-edit' }), (error) => error.code === 'LOCAL_CHANGED');
  assert.throws(() => assertMergePreviewCurrent(preview, { ...current, revision: 6 }), (error) => error.code === 'CLOUD_CHANGED');
});

test('real v5 lifecycle choices pass model validation with full photos and no active/trash collision', () => {
  const base = emptyState();
  base.items = [itemFromDraft({ id: 'dress', name: 'Платье', category: 'dress', colors: ['red'], seasons: ['summer'], photo: 'data:image/png;base64,AQ==' })];
  const [local, cloud] = variants(base);
  moveItemsToTrash(local, ['dress']);
  cloud.items[0].notes = 'Изменено на другом устройстве';
  const preview = mergeWardrobes(base, local, cloud);
  assert.equal(preview.unresolved, 1);
  for (const side of ['local', 'cloud']) {
    const resolved = mergeWardrobes(base, local, cloud, { [preview.conflicts[0].id]: side });
    assert.doesNotThrow(() => validateState(resolved.snapshot));
    const record = resolved.snapshot.items[0] || resolved.snapshot.trash[0].record;
    assert.equal(record.photo, 'data:image/png;base64,AQ==');
  }
});
