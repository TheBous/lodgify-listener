import type { IncomingGuestMessage } from "../domain/guest-message.js";
import type { Result } from "../domain/result.js";
import type { Triage } from "../domain/triage.js";

export type TriageError = "triage-unavailable" | "invalid-triage-response";
export type NotificationError = "notification-unavailable";

export type TriagePort = (message: IncomingGuestMessage) => Promise<Result<Triage, TriageError>>;

export type OwnerNotifier = (text: string) => Promise<Result<void, NotificationError>>;
