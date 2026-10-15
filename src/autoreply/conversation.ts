import { type ConversationState, emptyState, webhookSchema } from "./contracts.js";
import { controlConversation } from "./control.js";
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
      return acceptEvent(this.ctx.storage, event.data);
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
    try {
      await processJob({
        state,
        dependencies: createReplyDependencies(this.env),
        dryRun: this.env.AUTO_REPLY_ENABLED !== "true",
        save: () => this.ctx.storage.put("state", state),
      });
    } catch (error) {
      handleJobFailure(state, error);
      console.error(JSON.stringify({ event: "conversation_job_failed", error: state.lastError }));
    }
    await persistWork(this.ctx.storage, state);
  }

  private async control(state: ConversationState, path: string): Promise<Response> {
    const error = controlConversation(state, path);
    if (error) return error;
    await persistWork(this.ctx.storage, state);
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
