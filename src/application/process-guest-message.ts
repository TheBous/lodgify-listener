import type { IncomingGuestMessage } from "../domain/guest-message.js";
import type { PropertySections } from "../domain/property-context.js";
import type { Result } from "../domain/result.js";
import { decideNotification, type Triage, type TriageContext } from "../domain/triage.js";
import type { OwnerNotifier, ThreadHistoryPort, TriagePort } from "./ports.js";

export interface ProcessDependencies {
  triage: TriagePort;
  notifyOwner: OwnerNotifier;
  threadHistory: ThreadHistoryPort;
  propertyContext: string;
  propertySections: PropertySections;
}

export type ProcessOutcome = { kind: "ignored" } | { kind: "notified" } | { kind: "reply-drafted" };
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
      propertySections: dependencies.propertySections,
      history: history.ok ? history.value : [],
    };

    const triaged = await dependencies.triage(message, context);
    if (!triaged.ok) return triaged;

    if (
      triaged.value.category === "answerable" &&
      triaged.value.confidence >= 0.5 &&
      triaged.value.answerSection
    ) {
      const section = context.propertySections[triaged.value.answerSection];
      if (section) {
        const sent = await dependencies.notifyOwner(
          formatReplyDraft(message, triaged.value.answerSection, section),
        );
        if (!sent.ok) return sent;
        return { ok: true, value: { kind: "reply-drafted" } };
      }
    }

    if (decideNotification(triaged.value).kind === "ignore") {
      return { ok: true, value: { kind: "ignored" } };
    }

    const notified = await dependencies.notifyOwner(formatOwnerMessage(message, triaged.value));
    if (!notified.ok) return notified;
    return { ok: true, value: { kind: "notified" } };
  };
}

function formatReplyDraft(
  message: IncomingGuestMessage,
  sectionTitle: string,
  sectionBody: string,
): string {
  return [
    `RISPOSTA PRONTA (copia su Lodgify) - Booking: ${message.bookingId}`,
    `Guest: ${message.guestName}`,
    "",
    "---",
    `Gentile ${message.guestName},`,
    "",
    sectionBody,
    "",
    "A presto!",
    "---",
    "",
    `(fonte: sezione "${sectionTitle}" del contesto immobile)`,
  ].join("\n");
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
