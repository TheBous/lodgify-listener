import { type ConversationState, emptyState, fingerprint, type GuestEvent } from "./contracts.js";
import { DEBOUNCE_MS, enqueue } from "./state.js";

export async function acceptEvent(
  storage: DurableObjectStorage,
  event: GuestEvent,
): Promise<Response> {
  const hash = await fingerprint(event);
  return storage.transaction(async (transaction) => {
    const key = `receipt:${event.messageId}`;
    const previous = await transaction.get<string>(key);
    if (previous) {
      return new Response(previous === hash ? "duplicate" : "message ID conflict", {
        status: previous === hash ? 200 : 409,
      });
    }
    const state = (await transaction.get<ConversationState>("state")) ?? emptyState();
    const response = await enqueue(state, event);
    if (response.status !== 202) return response;
    await transaction.put(key, hash);
    await transaction.put("state", state);
    if (!state.job || state.job.attempts < 3) {
      await transaction.setAlarm(Date.now() + DEBOUNCE_MS);
    }
    return response;
  });
}

export async function persistWork(
  storage: DurableObjectStorage,
  state: ConversationState,
): Promise<void> {
  await storage.transaction(async (transaction) => {
    await transaction.put("state", state);
    const blocked = state.job?.kind === "notify" && state.job.attempts >= 3;
    if (!blocked && (state.job || state.pending.length > 0)) {
      const delay = state.job ? 1000 * (1 + state.job.attempts * 5) : DEBOUNCE_MS;
      await transaction.setAlarm(Date.now() + delay);
    } else {
      await transaction.deleteAlarm();
    }
  });
}
