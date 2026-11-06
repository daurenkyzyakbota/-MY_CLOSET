import { localDate, validDate, outfitStatus } from '../data/model.js';
import { putOutfit, putPlan } from '../data/closet-state.js';

export function applyWeekPlans(state, proposals, today = localDate()) {
  if (!Array.isArray(proposals) || !proposals.length || proposals.length > 7)
    throw new Error('Выберите от одного до семи дней.');
  const slots = new Set();
  for (const proposal of proposals) {
    if (
      !validDate(proposal.date) ||
      proposal.date < today ||
      !['day', 'evening'].includes(proposal.slot)
    )
      throw new Error('Проверьте дату и время каждого плана.');
    const key = `${proposal.date}:${proposal.slot}`;
    if (
      slots.has(key) ||
      state.plans.some((plan) => plan.date === proposal.date && plan.slot === proposal.slot)
    )
      throw new Error(
        'Один из промежутков уже занят. Обновите план недели — существующие планы сохранены.',
      );
    slots.add(key);
    const outfit = proposal.outfitId
      ? state.outfits.find((outfit) => outfit.id === proposal.outfitId)
      : proposal.outfit;
    if (
      !outfit ||
      !Array.isArray(outfit.itemIds) ||
      !outfit.itemIds.length ||
      !outfitStatus(outfit, state.items).complete
    )
      throw new Error('Состав образа изменился. Сначала проверьте доступность вещей.');
  }
  const plans = [];
  for (const proposal of proposals) {
    let outfit = proposal.outfitId
      ? state.outfits.find((outfit) => outfit.id === proposal.outfitId)
      : null;
    if (!outfit) {
      const draft = proposal.outfit;
      const composition = [...draft.itemIds].sort().join('|');
      outfit = state.outfits.find(
        (value) =>
          !value.missingItems?.length &&
          [...value.itemIds].sort().join('|') === composition &&
          value.occasion === draft.occasion &&
          value.style === (draft.style || '') &&
          value.season === (draft.season || ''),
      );
      if (!outfit)
        outfit = putOutfit(state, {
          name: draft.name,
          description: draft.description || '',
          itemIds: [...draft.itemIds],
          missingItems: [],
          occasion: draft.occasion,
          style: draft.style || '',
          season: draft.season || '',
        });
    }
    plans.push(putPlan(state, { date: proposal.date, slot: proposal.slot, outfitId: outfit.id }));
  }
  return plans;
}
