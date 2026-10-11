import type { Snapshot } from '../domain/index.js';
import type { Ctx } from './ctx.js';

/** Meds (stopped ones too) and every entry (undone ones too) of every pet: the domain decides what counts. */
export async function loadSnapshot(ctx: Ctx): Promise<Snapshot> {
  const petIds = ctx.settings.pets.map((p) => p.id);
  const meds = (await Promise.all(petIds.map((id) => ctx.repos.meds.listForPet(id)))).flat();
  const entries = (
    await Promise.all(petIds.map((id) => ctx.repos.entries.listForPet(id, { includeUndone: true })))
  ).flat();
  return { settings: ctx.settings, meds, entries };
}
