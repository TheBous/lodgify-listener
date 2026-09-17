export interface IncomingGuestMessage {
  threadId: string;
  bookingId: string;
  guestName: string;
  subject: string | null;
  message: string;
}

export type ThreadMessage = {
  from: "guest" | "owner";
  text: string;
  sentAt: string;
};
