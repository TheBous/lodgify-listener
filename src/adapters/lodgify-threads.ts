import type { ThreadHistoryPort } from "../application/ports.js";
import type { ThreadMessage } from "../domain/guest-message.js";

const MAX_MESSAGES = 20;

export function createLodgifyThreadHistory(apiKey: string): ThreadHistoryPort {
  return async (threadId) => {
    try {
      const res = await fetch(`https://api.lodgify.com/v2/messaging/${threadId}`, {
        headers: { "X-ApiKey": apiKey },
      });
      if (!res.ok) return { ok: false, error: "thread-history-unavailable" };
      return { ok: true, value: parseThreadMessages(await res.json(), threadId) };
    } catch {
      return { ok: false, error: "thread-history-unavailable" };
    }
  };
}

function parseThreadMessages(input: unknown, threadId: string): ThreadMessage[] {
  if (!Array.isArray(input)) return [];
  const thread = input.find(
    (t) => isRecord(t) && (t.thread_uid === threadId || input.length === 1),
  );
  if (!isRecord(thread) || !Array.isArray(thread.messages)) return [];
  return thread.messages
    .filter(isRecord)
    .map((m) => ({
      from: m.type === "Owner" ? ("owner" as const) : ("guest" as const),
      text: stripHtml(typeof m.message === "string" ? m.message : ""),
      sentAt: typeof m.date_created === "string" ? m.date_created : "",
    }))
    .filter((m) => m.text.length > 0)
    .slice(-MAX_MESSAGES);
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}
