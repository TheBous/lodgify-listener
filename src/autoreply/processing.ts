import {
  bookingId,
  type ConversationState,
  firstEvent,
  type Job,
  type ReplyDependencies,
} from "./contracts.js";
import { deliverReply } from "./delivery.js";
import { logDiagnostic } from "./diagnostics.js";
import { notificationJob as notice } from "./state.js";

export interface ProcessingOptions {
  state: ConversationState;
  dependencies: ReplyDependencies;
  dryRun: boolean;
  save: () => Promise<void>;
}

export async function processJob(options: ProcessingOptions): Promise<void> {
  const { state, dependencies } = options;
  const job = state.job;
  if (!job) return;
  if (job.kind === "notify") {
    await dependencies.notify(job.text, job.events[0]?.threadId);
    state.job = null;
    state.lastError = null;
    return;
  }
  if (job.kind === "prepare") {
    state.job = await prepareJob(options, job);
    state.lastError = null;
    return;
  }
  await deliverReply(options, job);
}

async function prepareJob(
  options: ProcessingOptions,
  job: Extract<Job, { kind: "prepare" }>,
): Promise<Job | null> {
  const { state, dependencies } = options;
  if (state.mode === "human") {
    logDiagnostic("info", "guest_reply_suppressed", {
      threadId: firstEvent(job.events).threadId,
      reason: "conversation_in_human_mode",
    });
    return notice(job, "NUOVO MESSAGGIO: assistente sospeso, rispondi su Lodgify.");
  }
  const event = firstEvent(job.events);
  if (job.events.some((message) => message.bookingId !== event.bookingId)) {
    state.mode = "human";
    logDiagnostic("warn", "guest_reply_suppressed", {
      threadId: event.threadId,
      reason: "multiple_booking_references_in_batch",
      eventCount: job.events.length,
    });
    return notice(
      job,
      "Prenotazioni diverse nello stesso thread: assistente sospeso, verifica Lodgify.",
    );
  }
  if (bookingId(event) === null) {
    logDiagnostic("info", "guest_reply_suppressed", {
      threadId: event.threadId,
      reason: "missing_booking_reference",
    });
    return notice(job, "Nessuna risposta: richiesta senza prenotazione confermata.");
  }
  const context = await dependencies.context(event);
  if (context.booking.status !== "Booked" || context.booking.deleted) {
    logDiagnostic("info", "guest_reply_suppressed", {
      threadId: event.threadId,
      reason: "booking_not_eligible",
      bookingStatus: context.booking.status,
      bookingDeleted: context.booking.deleted,
    });
    return notice(job, `Nessuna risposta: prenotazione ${context.booking.status} o eliminata.`);
  }
  const latestGuestTime = Math.max(...job.events.map((message) => Date.parse(message.createdAt)));
  const ownerRepliesAfterGuest = context.history.filter(
    (message) => message.from === "Owner" && Date.parse(message.sentAt) >= latestGuestTime,
  );
  if (ownerRepliesAfterGuest.length > 0) {
    state.mode = "human";
    logDiagnostic("info", "guest_reply_suppressed", {
      threadId: event.threadId,
      reason: "owner_replied_after_guest",
      historyMessageCount: context.history.length,
      matchingOwnerMessageCount: ownerRepliesAfterGuest.length,
    });
    return notice(
      job,
      "Il proprietario ha già risposto: assistente sospeso per evitare sovrapposizioni.",
    );
  }
  const decision = await dependencies.generate(job.events, context);
  logDiagnostic("info", "guest_reply_decision", {
    threadId: event.threadId,
    escalation: decision.escalation,
    replyLength: decision.reply.length,
  });
  if (decision.escalation === "ignore") return null;
  return {
    kind: "deliver",
    events: job.events,
    decision,
    fingerprint: context.fingerprint,
    replyId: crypto.randomUUID(),
    submitted: false,
    attempts: 0,
  };
}

export function handleJobFailure(state: ConversationState, error: unknown): void {
  const job = state.job;
  if (!job) throw new Error("Failure without a conversation job", { cause: error });
  state.lastError =
    error instanceof Error ? error.message.slice(0, 300) : "Unexpected processing error";
  job.attempts++;
  if (job.attempts < 3 || job.kind === "notify") return;
  state.mode = "human";
  const reason =
    job.kind === "deliver" && job.submitted
      ? `ESITO INVIO INCERTO (${job.replyId}): controlla Lodgify prima di rispondere.`
      : "ERRORE: nessuna risposta inviata dopo tre tentativi. Assistente sospeso.";
  state.job = notice(job, reason);
}
