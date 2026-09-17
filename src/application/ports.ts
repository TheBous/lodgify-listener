import type { IncomingGuestMessage, ThreadMessage } from "../domain/guest-message.js";
import type { Result } from "../domain/result.js";
import type { Triage, TriageContext } from "../domain/triage.js";

export type TriageError = "triage-unavailable" | "invalid-triage-response";
export type NotificationError = "notification-unavailable";
export type ThreadHistoryError = "thread-history-unavailable";

export type TriagePort = (
  message: IncomingGuestMessage,
  context: TriageContext,
) => Promise<Result<Triage, TriageError>>;

export type OwnerNotifier = (text: string) => Promise<Result<void, NotificationError>>;

export type ThreadHistoryPort = (
  threadId: string,
) => Promise<Result<ThreadMessage[], ThreadHistoryError>>;
