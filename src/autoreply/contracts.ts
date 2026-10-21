import { z } from "zod";

const identifier = z.union([z.string().min(1).max(100), z.number().int().nonnegative()]);
export const webhookSchema = z
  .object({
    action: z.literal("guest_message_received"),
    thread_uid: z.uuid(),
    message_id: identifier.transform(String),
    inbox_uid: z.string().max(100).nullable().optional(),
    guest_name: z.string().max(200).default(""),
    subject: z.string().max(500).nullable().optional(),
    message: z.string().max(8000).default(""),
    creation_time: z.iso.datetime({ offset: true }),
    has_attachments: z.boolean().default(false),
  })
  .transform((input) => ({
    threadId: input.thread_uid,
    messageId: input.message_id,
    bookingId: input.inbox_uid ?? "",
    guestName: input.guest_name,
    subject: input.subject ?? null,
    message: input.message,
    createdAt: input.creation_time,
    hasAttachments: input.has_attachments,
  }));

export type GuestEvent = z.infer<typeof webhookSchema>;
export const decisionSchema = z.discriminatedUnion("escalation", [
  z.object({ escalation: z.literal("ignore"), reply: z.literal("") }),
  z.object({
    escalation: z.enum(["no", "notifica", "umano"]),
    reply: z.string().trim().min(1).max(2500),
  }),
]);
export type ReplyDecision = z.infer<typeof decisionSchema>;

export interface BookingContext {
  id: number;
  threadId: string;
  status: string;
  propertyId: number;
  propertyName: string;
  arrival: string;
  departure: string;
  deleted: boolean;
}

export interface ConversationContext {
  booking: BookingContext;
  history: { from: "Owner" | "Renter" | "Comment"; text: string; sentAt: string }[];
  fingerprint: string;
  outbound: { id: string; status: string | null }[];
}

export interface ReplyDependencies {
  context: (event: GuestEvent) => Promise<ConversationContext>;
  generate: (events: GuestEvent[], context: ConversationContext) => Promise<ReplyDecision>;
  send: (job: DeliveryJob) => Promise<void>;
  notify: (text: string, threadId?: string) => Promise<void>;
}

export type Job =
  | { kind: "prepare"; events: GuestEvent[]; attempts: number }
  | DeliveryJob
  | { kind: "notify"; events: GuestEvent[]; text: string; attempts: number };

export interface DeliveryJob {
  kind: "deliver";
  events: GuestEvent[];
  decision: Exclude<ReplyDecision, { escalation: "ignore" }>;
  fingerprint: string;
  replyId: string;
  submitted: boolean;
  attempts: number;
}

export interface ConversationState {
  mode: "auto" | "human";
  pending: GuestEvent[];
  job: Job | null;
  lastError: string | null;
}

export const emptyState = (): ConversationState => ({
  mode: "auto",
  pending: [],
  job: null,
  lastError: null,
});

export function bookingId(event: GuestEvent): number | null {
  if (!/^B[1-9]\d*$/.test(event.bookingId)) return null;
  const id = Number(event.bookingId.slice(1));
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
}

export function firstEvent(events: GuestEvent[]): GuestEvent {
  const event = events[0];
  if (!event) throw new Error("Empty conversation batch");
  return event;
}

export async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
