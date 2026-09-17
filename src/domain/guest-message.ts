export interface IncomingGuestMessage {
  threadId: string;
  bookingId: string;
  guestName: string;
  subject: string | null;
  message: string;
}
