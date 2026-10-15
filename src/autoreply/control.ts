import type { ConversationState } from "./contracts.js";
import { notificationJob } from "./state.js";

export function controlConversation(state: ConversationState, path: string): Response | null {
  if (path === "/resume" && state.job) {
    return new Response(
      "Resolve pending job first: retry notification or pause and verify Lodgify",
      {
        status: 409,
      },
    );
  }
  if (path === "/resume") {
    state.mode = "auto";
    state.pending = [];
    state.lastError = null;
    return null;
  }
  if (path === "/pause") {
    pauseConversation(state);
    return null;
  }
  if (path === "/retry-notification" && state.job?.kind === "notify") {
    state.job.attempts = 0;
    return null;
  }
  return new Response("not found", { status: 404 });
}

function pauseConversation(state: ConversationState): void {
  state.mode = "human";
  const job = state.job;
  if (!job || job.kind === "notify") return;
  const reason =
    job.kind === "deliver" && job.submitted
      ? `ESITO INVIO INCERTO (${job.replyId}): verifica Lodgify. Assistente sospeso manualmente.`
      : "Assistente sospeso manualmente. Rispondi ai messaggi pendenti su Lodgify.";
  state.job = notificationJob(job, reason);
}
