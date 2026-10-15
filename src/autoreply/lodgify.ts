import { z } from "zod";
import { bookingId, fingerprint, type GuestEvent, type ReplyDependencies } from "./contracts.js";

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
const threadSchema = z.array(
  z.object({
    thread_uid: z.uuid(),
    is_closed: z.boolean(),
    messages: z
      .array(
        z.object({
          type: z.enum(["Owner", "Renter", "Comment"]),
          message: z.string().nullable(),
          date_created: z.iso.datetime({ offset: true }),
          message_id: z.uuid().nullable().optional(),
          message_status: z.string().nullable().optional(),
        }),
      )
      .nullable(),
  }),
);

export function createLodgifyMessaging(
  apiKey: string,
): Pick<ReplyDependencies, "context" | "send"> {
  const headers = {
    "X-ApiKey": apiKey,
    "content-type": "application/json",
    accept: "application/json",
  };
  async function read(path: string): Promise<unknown> {
    const response = await fetch(`https://api.lodgify.com${path}`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`Lodgify read failed (${response.status})`);
    return response.json();
  }
  return {
    context: async (event: GuestEvent) => {
      const id = bookingId(event);
      if (id === null) throw new Error("Missing booking ID or enquiry");
      const [rawBooking, rawThread] = await Promise.all([
        read(`/v1/reservation/booking/${id}`),
        read(`/v2/messaging/${encodeURIComponent(event.threadId)}`),
      ]);
      const booking = bookingSchema.parse(rawBooking);
      if (booking.id !== id || booking.thread_uid !== event.threadId) {
        throw new Error("Booking and thread do not match");
      }
      const thread = threadSchema
        .parse(rawThread)
        .find((item) => item.thread_uid === event.threadId);
      if (!thread || thread.is_closed || !thread.messages)
        throw new Error("Thread unavailable or closed");
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
        outbound: thread.messages.flatMap((message) =>
          message.message_id
            ? [{ id: message.message_id, status: message.message_status ?? null }]
            : [],
        ),
      };
    },
    send: async (job) => {
      const event = job.events[0];
      const id = event ? bookingId(event) : null;
      if (id === null) throw new Error("Cannot send without booking ID");
      const response = await fetch(
        `https://api.lodgify.com/v1/reservation/booking/${id}/messages`,
        {
          method: "POST",
          headers,
          signal: AbortSignal.timeout(4000),
          body: JSON.stringify([
            {
              message: job.decision.reply,
              type: "Owner",
              send_notification: true,
              message_id: job.replyId,
            },
          ]),
        },
      );
      if (!response.ok)
        throw new Error(`Lodgify send failed (${response.status}); verify delivery`);
    },
  };
}
