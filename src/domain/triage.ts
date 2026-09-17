import type { ThreadMessage } from "./guest-message.js";

export const CATEGORY = {
  answerable:
    "A polite or factual reply is possible using generic hospitality, the owner-provided property info in `property_context`, or information already present in `thread` (e.g. the owner already answered the same question earlier in the conversation).",
  needs_owner:
    "Answering requires information that is NOT in `property_context` and NOT already in `thread`, and that only the property owner has: exceptions to check-in/check-out times, repairs, extra services to confirm, pricing decisions, or anything about the specific property still missing.",
  no_reply:
    "No guest reply is appropriate: spam, marketing, automated notifications, or a message that asks nothing and needs no response.",
} as const;
export type Category = keyof typeof CATEGORY;

export const OWNER_TOPIC = {
  early_checkin_late_checkout:
    "Guest asks to arrive earlier or leave later than the standard times.",
  access_wifi_codes:
    "Guest needs wifi password, door codes, keys, or exact address/access details.",
  property_problem:
    "Guest reports something broken, dirty, missing, or malfunctioning in the property.",
  pricing_payment: "Guest asks about price, discounts, payment terms, deposit, or cancellation.",
  amenities_services:
    "Guest asks about extra services or amenities the owner must confirm (crib, parking, cleaning, pets, late food...).",
  booking_changes:
    "Guest wants to change dates, number of guests, extend the stay, or cancel the booking.",
  registration_documents:
    "Guest needs help with mandatory registration: identity documents, online check-in platform (e.g. Vikey), tourist tax, or legal stay requirements.",
  cleaning_linens:
    "Guest requests extra cleaning, fresh linens, towels, or consumables restocking during the stay.",
  lost_and_found:
    "Guest forgot personal items in the property and asks about recovering or having them shipped.",
  noise_neighbors:
    "Guests reports noise issues, neighbor complaints, or the owner must intervene on guest behavior.",
  refund_compensation:
    "Guest asks for a refund, partial discount, or compensation for an inconvenience during the stay.",
  pets_request:
    "Guest asks to bring pets and needs the owner's approval or pet-related arrangements.",
  emergency_access:
    "Guest is locked out, keys or codes do not work, or they cannot enter the property.",
  capacity_visitors: "Guest asks about bringing more people than declared or having visitors.",
  other: "Owner input is needed but does not fit the other topics.",
} as const;
export type OwnerTopic = keyof typeof OWNER_TOPIC;

export interface TriageContext {
  propertyContext: string;
  history: ThreadMessage[];
}

export interface Triage {
  category: Category;
  confidence: number;
  ownerTopic: OwnerTopic;
  urgent: boolean;
}

export type NotificationDecision = { kind: "notify-owner" } | { kind: "ignore" };

export function decideNotification(triage: Triage): NotificationDecision {
  if (triage.category === "needs_owner") return { kind: "notify-owner" };
  if (triage.category === "answerable" && triage.confidence < 0.5) {
    return { kind: "notify-owner" };
  }
  return { kind: "ignore" };
}
