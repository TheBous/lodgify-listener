import type { ConversationState, GuestEvent, Job } from "./contracts.js";

export const DEBOUNCE_MS = 15_000;
export const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function enqueue(state: ConversationState, event: GuestEvent): Promise<Response> {
  const timestamp = Date.parse(event.createdAt);
  if (timestamp < Date.now() - RECEIPT_RETENTION_MS)
    return new Response("expired", { status: 200 });
  if (timestamp > Date.now() + 300_000) return new Response("future timestamp", { status: 400 });
  const buffered = [...(state.job?.events ?? []), ...state.pending, event];
  const size = new TextEncoder().encode(JSON.stringify(buffered)).byteLength;
  if (buffered.length > 20 || size > 40_000) {
    return new Response("conversation buffer full", { status: 429 });
  }
  // A generated answer has no effect yet. Include new arrivals before sending it.
  if (state.job?.kind === "prepare" || (state.job?.kind === "deliver" && !state.job.submitted)) {
    state.pending.unshift(...state.job.events);
    state.job = null;
  }
  state.pending.push(event);
  state.pending.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  return new Response("queued", { status: 202 });
}

export function teamNotice(events: GuestEvent[], reason: string, reply = ""): string {
  const guest = events[0];
  return [
    reason,
    `Ospite: ${guest?.guestName || "nome non disponibile"}`,
    `Prenotazione: ${guest?.bookingId || "ID mancante"}`,
    `Thread: ${guest?.threadId}`,
    "",
    events
      .map((event) => event.message || "[Allegato senza testo]")
      .join("\n")
      .slice(0, 1800),
    reply ? `\nRisposta: ${reply.slice(0, 1400)}` : "",
    "",
    "Gestisci la conversazione nella Inbox Lodgify.",
    "Per riprendere le risposte: POST /conversations/THREAD/resume con il token amministratore.",
  ].join("\n");
}

export function notificationJob(
  job: Job,
  reason: string,
  reply = "",
): Extract<Job, { kind: "notify" }> {
  return {
    kind: "notify",
    events: job.events,
    text: teamNotice(job.events, reason, reply),
    attempts: 0,
  };
}
