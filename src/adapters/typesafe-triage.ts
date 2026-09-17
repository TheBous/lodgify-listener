import { choice, noul, TypeSafeClient } from "@typesafe-ai/sdk";
import type { TriagePort } from "../application/ports.js";
import type { Result } from "../domain/result.js";
import {
  CATEGORY,
  type Category,
  OWNER_TOPIC,
  type OwnerTopic,
  type Triage,
} from "../domain/triage.js";

export function createTypeSafeTriage(apiKey: string): TriagePort {
  const client = new TypeSafeClient({ apiKey });
  return async (message) => {
    try {
      const response = await client.systemOne({
        state: {
          booking_ref: message.bookingId,
          guest_name: message.guestName,
          subject: message.subject,
          message: message.message,
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
      return parseTriageResponse(response);
    } catch (error) {
      console.error("TypeSafe triage failed:", error);
      return { ok: false, error: "triage-unavailable" };
    }
  };
}

function parseTriageResponse(input: unknown): Result<Triage, "invalid-triage-response"> {
  if (!isRecord(input) || !isRecord(input.answers)) {
    return { ok: false, error: "invalid-triage-response" };
  }
  const category = parseCategory(input.answers.category);
  const ownerTopic = parseOwnerTopic(input.answers.owner_topic);
  const urgent = parseNoul(input.answers.owner_urgent);
  if (!category || !ownerTopic || urgent === null) {
    return { ok: false, error: "invalid-triage-response" };
  }
  return {
    ok: true,
    value: {
      category: category.value,
      confidence: category.confidence,
      ownerTopic,
      urgent,
    },
  };
}

function parseCategory(input: unknown): { value: Category; confidence: number } | null {
  if (!isRecord(input) || !isCategory(input.choice) || !probability(input.confidence)) return null;
  return { value: input.choice, confidence: input.confidence };
}

function parseOwnerTopic(input: unknown): OwnerTopic | null {
  if (!isRecord(input) || !isOwnerTopic(input.choice)) return null;
  return input.choice;
}

function parseNoul(input: unknown): boolean | null {
  if (!isRecord(input) || !probability(input.noul)) return null;
  return input.noul >= 0.8;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function probability(input: unknown): input is number {
  return typeof input === "number" && input >= 0 && input <= 1;
}

function isCategory(input: unknown): input is Category {
  return typeof input === "string" && input in CATEGORY;
}

function isOwnerTopic(input: unknown): input is OwnerTopic {
  return typeof input === "string" && input in OWNER_TOPIC;
}
