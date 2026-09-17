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
    "Guest asks about extra services or amenities the owner must confirm (crib, parking, cleaning, pets, latefood...).",
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
