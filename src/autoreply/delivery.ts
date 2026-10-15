import { type ConversationState, type DeliveryJob, firstEvent } from "./contracts.js";
import type { ProcessingOptions } from "./processing.js";
import { notificationJob } from "./state.js";

export async function deliverReply(options: ProcessingOptions, job: DeliveryJob): Promise<void> {
  const { state, dependencies, save } = options;
  if (options.dryRun) {
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
      completeDelivery(state, job);
      return;
    }
    // Submitted/unknown can still be delivered later; do not submit another message.
    throw new Error(`Message ${job.replyId} status ${receipt.status ?? "unknown"}; verify Lodgify`);
  }
  if (
    context.fingerprint !== job.fingerprint ||
    context.booking.status !== "Booked" ||
    context.booking.deleted
  ) {
    state.mode = "human";
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
