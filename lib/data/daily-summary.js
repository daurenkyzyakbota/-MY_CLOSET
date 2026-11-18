import { localDate, outfitStatus, validDate } from './model.js';
import { getWearStatistics } from './wardrobe-life.js';

export function everydaySummary(state, today = localDate()) {
  if (!validDate(today)) throw new Error('Укажите корректную дату.');
  const stats = getWearStatistics(state, today);
  const outfits = new Map(state.outfits.map((outfit) => [outfit.id, outfit]));
  const todayWear = state.wearLog.filter((record) => record.date === today);
  const plans = state.plans
    .filter((plan) => plan.date === today)
    .sort((a, b) => (a.slot === 'day' ? 0 : 1) - (b.slot === 'day' ? 0 : 1))
    .map((plan) => {
      const outfit = outfits.get(plan.outfitId);
      const status = outfit ? outfitStatus(outfit, state.items) : null;
      const ids = outfit?.itemIds.slice().sort().join('|');
      const worn =
        !!outfit &&
        todayWear.some(
          (record) =>
            record.outfitId === outfit.id || record.itemIds.slice().sort().join('|') === ids,
        );
      return { plan, outfit: outfit || null, complete: status?.complete || false, worn };
    });
  const forgotten = stats.items
    .filter((row) => row.item.available && (row.lastWorn === null || row.daysSinceLastWorn >= 30))
    .sort(
      (a, b) =>
        Number(a.lastWorn !== null) - Number(b.lastWorn !== null) ||
        (a.lastWorn || '').localeCompare(b.lastWorn || '') ||
        a.item.name.localeCompare(b.item.name, 'ru'),
    )
    .slice(0, 3);
  return {
    plans,
    forgotten,
    laundryCount: state.items.filter((item) => !item.available).length,
    readyOutfits: state.outfits.filter((outfit) => outfitStatus(outfit, state.items).complete)
      .length,
    steps: [state.items.length > 0, state.outfits.length > 0, state.plans.length > 0],
  };
}
