import { type ConversationState, type DeliveryJob, firstEvent } from "./contracts.js";
import { logDiagnostic } from "./diagnostics.js";
import type { ProcessingOptions } from "./processing.js";
import { notificationJob } from "./state.js";

export async function deliverReply(options: ProcessingOptions, job: DeliveryJob): Promise<void> {
  const { state, dependencies, save } = options;
  if (options.dryRun) {
    logDiagnostic("info", "guest_reply_not_sent", {
      threadId: firstEvent(job.events).threadId,
      reason: "dry_run_enabled",
      escalation: job.decision.escalation,
      replyLength: job.decision.reply.length,
    });
    state.job = notificationJob(
      job,
      "ANTEPRIMA: nessun messaggio inviato all'ospite.",
      job.decision.reply,
    );
    return;
  }
  const context = await dependencies.context(firstEvent(job.events));
  const receipt = context.outbound.find((message) => message.id === job.replyId);
  if (receipt) {
    if (receipt.status === "Sent" || receipt.status === "Delivered") {
      logDiagnostic("info", "lodgify_delivery_reconciled", {
        threadId: firstEvent(job.events).threadId,
        status: receipt.status,
      });
      completeDelivery(state, job);
      return;
    }
    logDiagnostic("warn", "lodgify_delivery_unresolved", {
      threadId: firstEvent(job.events).threadId,
      status: receipt.status,
    });
    // Submitted/unknown can still be delivered later; do not submit another message.
    throw new Error(`Message ${job.replyId} status ${receipt.status ?? "unknown"}; verify Lodgify`);
  }
  if (
    context.fingerprint !== job.fingerprint ||
    context.booking.status !== "Booked" ||
    context.booking.deleted
  ) {
    state.mode = "human";
    logDiagnostic("warn", "guest_reply_not_sent", {
      threadId: firstEvent(job.events).threadId,
      reason: context.fingerprint !== job.fingerprint ? "conversation_changed" : "booking_changed",
      wasPreviouslySubmitted: job.submitted,
      bookingStatus: context.booking.status,
      bookingDeleted: context.booking.deleted,
    });
    state.job = notificationJob(
      job,
      job.submitted
        ? `ESITO INVIO INCERTO (${job.replyId}): controlla Lodgify prima di rispondere.`
        : "Conversazione o prenotazione cambiata: nessuna risposta inviata. Assistente sospeso.",
    );
    return;
  }
  job.submitted = true;
  await save();
  await dependencies.send(job);
  completeDelivery(state, job);
}

function completeDelivery(state: ConversationState, job: DeliveryJob): void {
  state.lastError = null;
  if (job.decision.escalation === "umano") state.mode = "human";
  logDiagnostic("info", "lodgify_delivery_completed", {
    threadId: firstEvent(job.events).threadId,
    escalation: job.decision.escalation,
    mode: state.mode,
  });
  state.job =
    job.decision.escalation === "no"
      ? null
      : notificationJob(
          job,
          job.decision.escalation === "umano"
            ? "INTERVENTO UMANO: cortesia inoltrata, assistente sospeso."
            : "DA VERIFICARE: risposta inoltrata, assistente ancora attivo.",
          job.decision.reply,
        );
}
