import type { OwnerNotifier } from "../application/ports.js";

export function createTelegramNotifier(token: string, chatId: string): OwnerNotifier {
  return async (text) => {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!response.ok) {
        console.error(`Telegram sendMessage failed: ${response.status} ${await response.text()}`);
        return { ok: false, error: "notification-unavailable" };
      }
      return { ok: true, value: undefined };
    } catch (error) {
      console.error("Telegram notification failed:", error);
      return { ok: false, error: "notification-unavailable" };
    }
  };
}
