import { choice, noul, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient();

const CATEGORY = {
  answerable:
    "A polite or factual reply is possible using only generic hospitality or info already contained in the conversation (greetings, thank-yous, confirming receipt).",
  needs_owner:
    "Answering requires information only the property owner has: check-in/check-out times, wifi or access codes, address details, house rules, amenities, extra services, pricing, repairs, or anything about the specific property.",
  no_reply:
    "No guest reply is appropriate: spam, marketing, automated notifications, or a message that asks nothing and needs no response.",
} as const;
export type Category = keyof typeof CATEGORY;

const OWNER_TOPIC = {
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

export interface IncomingGuestMessage {
  inbox_uid: string;
  guest_name: string;
  subject: string | null;
  message: string;
}

export interface Triage {
  category: Category;
  confidence: number;
  ownerTopic: OwnerTopic;
  urgent: boolean;
}

export async function triage(msg: IncomingGuestMessage): Promise<Triage> {
  const response = await client.systemOne({
    state: {
      booking_ref: msg.inbox_uid,
      guest_name: msg.guest_name,
      subject: msg.subject,
      message: msg.message,
    },
    questions: {
      category: choice(
        "A guest of a vacation rental sent the message in `message`. Which category describes it?",
        CATEGORY,
      ),
      owner_topic: choice(
        "If answering `message` requires information only the property owner has, what does the owner need to provide or decide?",
        OWNER_TOPIC,
      ),
      owner_urgent: noul(
        "Would the property owner consider `message` time-critical (guest arriving within 24 hours, something broken or unsafe, booking about to be lost)?",
      ),
    },
  });

  return {
    category: response.answers.category.choice,
    confidence: response.answers.category.confidence,
    ownerTopic: response.answers.owner_topic.choice,
    urgent: response.answers.owner_urgent.noul >= 0.8,
  };
}

export function shouldNotifyOwner(t: Triage): boolean {
  if (t.category === "needs_owner") return true;
  // Uncertain classification -> escalate to the human, it is the safe direction.
  return t.category === "answerable" && t.confidence < 0.5;
}
