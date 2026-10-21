import { z } from "zod";
import { bookingId, fingerprint, type GuestEvent, type ReplyDependencies } from "./contracts.js";
import { errorType, logDiagnostic, validationIssues } from "./diagnostics.js";
import { requestLodgify } from "./lodgify-request.js";

const bookingSchema = z.object({
  id: z.number().int(),
  thread_uid: z.uuid(),
  type: z.literal("Booking"),
  status: z.string(),
  property_id: z.number().int(),
  property_name: z.string(),
  arrival: z.iso.date(),
  departure: z.iso.date(),
  is_deleted: z.boolean(),
});
const threadItemSchema = z.object({
  thread_uid: z.uuid(),
  is_closed: z.boolean(),
  messages: z
    .array(
      z.object({
        type: z.enum(["Owner", "Renter", "Comment"]),
        message: z.string().nullable(),
        date_created: z.iso.datetime({ offset: true, local: true }),
        message_id: z.guid().nullable().optional(),
        message_status: z.string().nullable().optional(),
      }),
    )
    .nullable(),
});
const threadSchema = z.union([threadItemSchema, z.array(threadItemSchema)]);

export function createLodgifyMessaging(
  apiKey: string,
): Pick<ReplyDependencies, "context" | "send"> {
  async function read(path: string, label: string, threadId: string): Promise<unknown> {
    const response = await requestLodgify({
      apiKey,
      operation: `${label}.read`,
      label,
      kind: "read",
      method: "GET",
      path,
      threadId,
    });
    try {
      return await response.json();
    } catch (error) {
      logDiagnostic("warn", "provider_response_invalid_json", {
        provider: "lodgify",
        operation: `${label}.read`,
        status: response.status,
        threadId,
        errorType: errorType(error),
      });
      throw new Error(`Lodgify ${label} read returned invalid JSON`);
    }
  }
  return {
    context: async (event: GuestEvent) => {
      const id = bookingId(event);
      if (id === null) throw new Error("Missing booking ID or enquiry");
      const rawBooking = await read(`/v1/reservation/booking/${id}`, "booking", event.threadId);
      const rawThread = await read(
        `/v2/messaging/${encodeURIComponent(event.threadId)}`,
        "thread",
        event.threadId,
      );
      const parsedBooking = bookingSchema.safeParse(rawBooking);
      if (!parsedBooking.success) {
        logDiagnostic("warn", "lodgify_response_schema_invalid", {
          operation: "booking.read",
          threadId: event.threadId,
          issues: validationIssues(parsedBooking.error),
        });
        throw new Error("Lodgify booking response failed schema validation");
      }
      const booking = parsedBooking.data;
      if (booking.id !== id || booking.thread_uid !== event.threadId) {
        logDiagnostic("warn", "lodgify_booking_thread_mismatch", {
          threadId: event.threadId,
          bookingIdMatched: booking.id === id,
          threadIdMatched: booking.thread_uid === event.threadId,
        });
        throw new Error("Booking and thread do not match");
      }
      const parsedThread = threadSchema.safeParse(rawThread);
      if (!parsedThread.success) {
        logDiagnostic("warn", "lodgify_response_schema_invalid", {
          operation: "thread.read",
          threadId: event.threadId,
          issues: validationIssues(parsedThread.error),
        });
        throw new Error("Lodgify thread response failed schema validation");
      }
      const threads = Array.isArray(parsedThread.data) ? parsedThread.data : [parsedThread.data];
      const thread = threads.find((item) => item.thread_uid === event.threadId);
      if (!thread || thread.is_closed || !thread.messages) {
        logDiagnostic("warn", "lodgify_thread_unavailable", {
          threadId: event.threadId,
          found: Boolean(thread),
          closed: thread?.is_closed ?? null,
          hasMessages: thread?.messages !== null && thread?.messages !== undefined,
        });
        throw new Error("Thread unavailable or closed");
      }
      const history = thread.messages
        .filter((message) => message.type !== "Comment")
        .sort((left, right) => Date.parse(left.date_created) - Date.parse(right.date_created))
        .slice(-20)
        .map((message) => ({
          from: message.type,
          text: (message.message ?? "[Attachment without text]")
            .replace(/<[^>]*>/g, " ")
            .slice(0, 1500),
          sentAt: message.date_created,
        }));
      const messageCounts = {
        total: thread.messages.length,
        owner: thread.messages.filter((message) => message.type === "Owner").length,
        renter: thread.messages.filter((message) => message.type === "Renter").length,
        comment: thread.messages.filter((message) => message.type === "Comment").length,
      };
      const outbound = thread.messages.flatMap((message) =>
        message.message_id
          ? [{ id: message.message_id, status: message.message_status ?? null }]
          : [],
      );
      logDiagnostic("info", "lodgify_context_loaded", {
        threadId: event.threadId,
        bookingStatus: booking.status,
        bookingDeleted: booking.is_deleted,
        threadMessageCounts: messageCounts,
        historyMessageCount: history.length,
        outboundMessageCount: outbound.length,
      });
      return {
        booking: {
          id,
          threadId: booking.thread_uid,
          status: booking.status,
          propertyId: booking.property_id,
          propertyName: booking.property_name,
          arrival: booking.arrival,
          departure: booking.departure,
          deleted: booking.is_deleted,
        },
        history,
        fingerprint: await fingerprint({ booking, history }),
        outbound,
      };
    },
    send: async (job) => {
      const event = job.events[0];
      if (!event) throw new Error("Cannot send without a conversation event");
      const id = bookingId(event);
      if (id === null) throw new Error("Cannot send without booking ID");
      try {
        await requestLodgify({
          apiKey,
          operation: "message.send",
          label: "messages",
          kind: "send",
          method: "POST",
          path: `/v1/reservation/booking/${id}/messages`,
          threadId: event.threadId,
          body: JSON.stringify([
            {
              message: job.decision.reply,
              type: "Owner",
              send_notification: true,
              message_id: job.replyId,
            },
          ]),
        });
      } catch (error) {
        if (error instanceof Error)
          throw new Error(`${error.message}; verify delivery`, { cause: error });
        throw error;
      }
    },
  };
}
