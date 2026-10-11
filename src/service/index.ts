import type { Callback } from '../types.js';
import * as admin from './admin.js';
import { dispatchCallback } from './callbacks.js';
import { createMutex, isAdmin, makeCtx } from './ctx.js';
import type { ServiceDeps } from './ctx.js';
import { typedTime } from './panel.js';
import { ensureBoards, reconcile } from './refresh.js';
import type { CallbackCtx, CallbackResult, Service } from './types.js';

export { ServiceError } from './errors.js';
export type { Logger, ServiceDeps } from './ctx.js';
export type { CallbackCtx, CallbackResult, Service, TypedTimeCtx, TypedTimeResult } from './types.js';

/** The use-case layer the Telegram wiring calls. Everything that writes runs one at a time. */
export function createService(deps: ServiceDeps): Service {
  const ctx = makeCtx(deps);
  const serial = createMutex();
  const now = () => ctx.clock.now();

  async function handleCallback(cb: Callback, c: CallbackCtx): Promise<CallbackResult> {
    try {
      return await dispatchCallback(ctx, cb, c);
    } catch (err) {
      ctx.log.error('callback failed', err);
      return { toast: 'Something went wrong, please try again.', alert: true };
    }
  }

  return {
    reconcile: () => serial(() => reconcile(ctx)),
    handleCallback: (cb, c) => serial(() => handleCallback(cb, c)),
    handleTypedTime: (t) => serial(() => typedTime(ctx, t, now())),
    isAdmin: (userId) => isAdmin(ctx, userId),
    startMed: (draft, by) => serial(() => admin.startMed(ctx, draft, by)),
    stopMed: (medId, by) => serial(() => admin.stopMed(ctx, medId, by)),
    editMed: (medId, patch, by) => serial(() => admin.editMed(ctx, medId, patch, by)),
    listMeds: (petId) => ctx.repos.meds.listActive(petId),
    listPastEntries: (petId, days) => admin.listPastEntries(ctx, petId, days),
    openFixPanel: (entryId, chatId, threadId, by) => serial(() => admin.openFixPanel(ctx, entryId, chatId, threadId, by)),
    ensureBoards: () => serial(() => ensureBoards(ctx)),
  };
}
