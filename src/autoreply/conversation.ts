import { type ConversationState, emptyState, webhookSchema } from "./contracts.js";
import { controlConversation } from "./control.js";
import { errorType, logDiagnostic } from "./diagnostics.js";
import { createReplyDependencies, type WorkerEnv } from "./environment.js";
import { handleJobFailure, processJob } from "./processing.js";
import { acceptEvent, persistWork } from "./storage.js";

export class Conversation {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: WorkerEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const input: unknown = path === "/event" ? await request.json() : null;
    return this.ctx.blockConcurrencyWhile(async () => {
      const state = (await this.ctx.storage.get<ConversationState>("state")) ?? emptyState();
      if (request.method === "GET") return status(state);
      if (path !== "/event") return this.control(state, path);
      const event = webhookSchema.safeParse(input);
      if (!event.success) return new Response("invalid webhook", { status: 400 });
      const response = await acceptEvent(this.ctx.storage, event.data);
      const responseText = await response.clone().text();
      const knownOutcomes = new Set([
        "queued",
        "duplicate",
        "message ID conflict",
        "expired",
        "future timestamp",
        "conversation buffer full",
      ]);
      logDiagnostic(response.status >= 400 ? "warn" : "info", "conversation_event_received", {
        threadId: event.data.threadId,
        messageCreatedAt: event.data.createdAt,
        messageLength: event.data.message.length,
        hasAttachments: event.data.hasAttachments,
        bookingReferencePresent: Boolean(event.data.bookingId),
        responseStatus: response.status,
        queueOutcome: knownOutcomes.has(responseText) ? responseText : "unknown",
      });
      return response;
    });
  }

  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const state = (await this.ctx.storage.get<ConversationState>("state")) ?? emptyState();
      if (!state.job && state.pending.length === 0) return;
      if (!state.job) {
        state.job = { kind: "prepare", events: state.pending, attempts: 0 };
        state.pending = [];
        await this.ctx.storage.put("state", state);
      }
      if (state.job.attempts >= 3 && state.job.kind === "notify") return;
      await this.runJob(state);
    });
  }

  private async runJob(state: ConversationState): Promise<void> {
    const initialJob = state.job;
    if (!initialJob) return;
    const startedAt = Date.now();
    const attempt = initialJob.attempts + 1;
    const threadId = initialJob.events[0]?.threadId;
    const dryRun = this.env.AUTO_REPLY_ENABLED !== "true";
    logDiagnostic("info", "conversation_job_started", {
      ...(threadId ? { threadId } : {}),
      kind: initialJob.kind,
      attempt,
      eventCount: initialJob.events.length,
      mode: state.mode,
      pendingCount: state.pending.length,
      dryRun,
    });
    let failureType: string | undefined;
    try {
      await processJob({
        state,
        dependencies: createReplyDependencies(this.env),
        dryRun,
        save: () => this.ctx.storage.put("state", state),
      });
    } catch (error) {
      failureType = errorType(error);
      handleJobFailure(state, error);
      logDiagnostic("error", "conversation_job_failed", {
        ...(threadId ? { threadId } : {}),
        kind: initialJob.kind,
        attempt,
        errorType: failureType,
        error: state.lastError,
        mode: state.mode,
        resultingJobKind: state.job?.kind ?? null,
      });
    }
    await persistWork(this.ctx.storage, state);
    logDiagnostic(failureType ? "warn" : "info", "conversation_job_finished", {
      ...(threadId ? { threadId } : {}),
      kind: initialJob.kind,
      attempt,
      outcome: failureType ? "failed" : "completed",
      durationMs: Date.now() - startedAt,
      mode: state.mode,
      resultingJobKind: state.job?.kind ?? null,
      pendingCount: state.pending.length,
      lastError: state.lastError,
    });
  }

  private async control(state: ConversationState, path: string): Promise<Response> {
    const error = controlConversation(state, path);
    if (error) return error;
    await persistWork(this.ctx.storage, state);
    logDiagnostic("info", "conversation_control_applied", {
      action: path.slice(1),
      mode: state.mode,
      jobKind: state.job?.kind ?? null,
      pendingCount: state.pending.length,
    });
    return status(state);
  }
}

function status(state: ConversationState): Response {
  return Response.json({
    mode: state.mode,
    pending: state.pending.length,
    job: state.job
      ? {
          kind: state.job.kind,
          attempts: state.job.attempts,
          replyId: state.job.kind === "deliver" ? state.job.replyId : null,
          submitted: state.job.kind === "deliver" && state.job.submitted,
        }
      : null,
    lastError: state.lastError,
  });
}
