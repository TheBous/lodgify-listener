import type { IncomingGuestMessage } from "../domain/guest-message.js";
import type { Result } from "../domain/result.js";
import { decideNotification, type Triage, type TriageContext } from "../domain/triage.js";
import type { OwnerNotifier, ThreadHistoryPort, TriagePort } from "./ports.js";

export interface ProcessDependencies {
  triage: TriagePort;
  notifyOwner: OwnerNotifier;
  threadHistory: ThreadHistoryPort;
  propertyContext: string;
}

export type ProcessOutcome = { kind: "ignored" } | { kind: "notified" };
export type ProcessError =
  | "triage-unavailable"
  | "invalid-triage-response"
  | "notification-unavailable";
export type ProcessGuestMessage = (
  message: IncomingGuestMessage,
) => Promise<Result<ProcessOutcome, ProcessError>>;

export function createMessageProcessor(dependencies: ProcessDependencies): ProcessGuestMessage {
  return async (message) => {
    const history = await dependencies.threadHistory(message.threadId);
    if (!history.ok) {
      // ponytail: degraded history still triages on the new message alone; add a retry queue if accuracy suffers
      console.error(`[${message.bookingId}] thread history unavailable, triaging without it`);
    }
    const context: TriageContext = {
      propertyContext: dependencies.propertyContext,
      history: history.ok ? history.value : [],
    };

    const triaged = await dependencies.triage(message, context);
    if (!triaged.ok) return triaged;
    if (decideNotification(triaged.value).kind === "ignore") {
      return { ok: true, value: { kind: "ignored" } };
    }

    const notified = await dependencies.notifyOwner(formatOwnerMessage(message, triaged.value));
    if (!notified.ok) return notified;
    return { ok: true, value: { kind: "notified" } };
  };
}

function formatOwnerMessage(message: IncomingGuestMessage, triage: Triage): string {
  const lines = [
    triage.urgent ? "URGENT - guest needs your input" : "Guest needs your input",
    `Booking: ${message.bookingId}`,
    `Guest: ${message.guestName}`,
    `Topic: ${triage.ownerTopic}`,
  ];
  if (message.subject) lines.push(`Subject: ${message.subject}`);
  lines.push("", message.message.slice(0, 3500), "", `Thread: ${message.threadId}`);
  return lines.join("\n");
}
