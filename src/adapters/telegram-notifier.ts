import type { OwnerNotifier } from "../application/ports.js";

export function createTelegramNotifier(token: string, chatIds: string): OwnerNotifier {
  const ids = chatIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return async (text) => {
    if (ids.length === 0) return { ok: false, error: "notification-unavailable" };
    const results = await Promise.allSettled(ids.map((chatId) => send(token, chatId, text)));
    let delivered = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        delivered++;
      } else {
        console.error("Telegram notification failed:", result.reason);
      }
    }
    return delivered > 0
      ? { ok: true, value: undefined }
      : { ok: false, error: "notification-unavailable" };
  };
}

async function send(token: string, chatId: string, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
}
