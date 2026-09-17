import { createLodgifyThreadHistory } from "./adapters/lodgify-threads.js";
import { createTelegramNotifier } from "./adapters/telegram-notifier.js";
import { createTypeSafeTriage } from "./adapters/typesafe-triage.js";
import type { ProcessDependencies } from "./application/process-guest-message.js";
import { createMessageProcessor } from "./application/process-guest-message.js";
import { parsePropertySections } from "./domain/property-context.js";
import { parseGuestMessage } from "./http/lodgify-webhook.js";

export interface WorkerEnv {
  TYPESAFE_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  LODGIFY_API_KEY: string;
  /** Full markdown of the property context (data/property-context.md locally). */
  PROPERTY_CONTEXT_MD?: string;
}

function createWorkerDependencies(env: WorkerEnv): ProcessDependencies {
  const propertyContext = env.PROPERTY_CONTEXT_MD ?? "";
  return {
    triage: createTypeSafeTriage(env.TYPESAFE_API_KEY),
    notifyOwner: createTelegramNotifier(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID),
    threadHistory: createLodgifyThreadHistory(env.LODGIFY_API_KEY),
    propertyContext,
    propertySections: parsePropertySections(propertyContext),
  };
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/webhook/lodgify") {
      return new Response("not found", { status: 404 });
    }
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response("invalid body", { status: 400 });
    }
    const message = parseGuestMessage(payload);
    if (!message.ok) {
      return new Response("ignored", { status: 200 });
    }
    const processor = createMessageProcessor(createWorkerDependencies(env));
    const result = await processor(message.value);
    if (!result.ok) {
      console.error(`[${message.value.bookingId}] processing failed:`, result.error);
      return new Response("processing failed", { status: 500 });
    }
    console.log(`[${message.value.bookingId}] ${result.value.kind}`);
    return new Response("ok");
  },
};
