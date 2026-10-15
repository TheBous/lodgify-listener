import type {
  ConversationContext,
  GuestEvent,
  ReplyDecision,
  ReplyDependencies,
} from "./contracts.js";

export const threadId = "dd51acc0-ebfb-4659-a6b3-0072538dbfaf";
export const event = (messageId = "1"): GuestEvent => ({
  threadId,
  messageId,
  bookingId: "B123",
  guestName: "Guest",
  subject: null,
  message: "When can we check in?",
  createdAt: new Date().toISOString(),
  hasAttachments: false,
});
export const webhook = (messageId = 1) => ({
  action: "guest_message_received",
  thread_uid: threadId,
  message_id: messageId,
  inbox_uid: "B123",
  guest_name: "Guest",
  message: "When can we check in?",
  creation_time: new Date().toISOString(),
  has_attachments: false,
});
export const context = (): ConversationContext => ({
  booking: {
    id: 123,
    threadId,
    status: "Booked",
    propertyId: 42,
    propertyName: "Test property",
    arrival: "2026-10-15",
    departure: "2026-10-18",
    deleted: false,
  },
  history: [],
  fingerprint: "history-1",
  outbound: [],
});

export function harness(
  decision: ReplyDecision = { escalation: "no", reply: "Check-in is from 4 PM." },
) {
  const sent: string[] = [];
  const notices: string[] = [];
  const generated: GuestEvent[][] = [];
  const currentContext = context();
  const dependencies: ReplyDependencies = {
    context: async () => currentContext,
    generate: async (events) => {
      generated.push(events);
      return decision;
    },
    send: async (job) => {
      sent.push(job.replyId);
    },
    notify: async (text) => {
      notices.push(text);
    },
  };
  return { dependencies, sent, notices, generated, currentContext };
}

export function modelResponse(input: unknown) {
  return {
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(input), annotations: [] }],
      },
    ],
  };
}
