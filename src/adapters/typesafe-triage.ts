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
  return async (message, context) => {
    try {
      const response = await client.systemOne({
        state: {
          booking_ref: message.bookingId,
          guest_name: message.guestName,
          subject: message.subject,
          message: message.message,
          property_context: context.propertyContext || "(property context not provided yet)",
          thread:
            context.history.length > 0
              ? context.history
              : "(no earlier messages: this is the first one)",
        },
        questions: {
          category: choice(
            "A guest of a vacation rental sent the message in `message`. Check `property_context` (info the owner wrote about the property) and the earlier messages in `thread` (which may already contain answers from the owner): if the information needed to reply is there, the message is answerable without the owner. Which category describes `message`?",
            CATEGORY,
          ),
          answer_section: choice(
            "If the full information needed to reply to `message` is contained in exactly one section of `property_context`, which section? If no single section fully answers the guest, choose none.",
            sectionCriteria(context.propertySections),
          ),
          owner_topic: choice(
            "If answering `message` requires information the owner must provide because it is missing from `property_context` and `thread`, what does the owner need to provide or decide?",
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

function sectionCriteria(sections: Record<string, string>): Record<string, string> {
  const criteria: Record<string, string> = {
    none: "No section fully answers the guest's message.",
  };
  for (const [title, body] of Object.entries(sections)) {
    criteria[title] = body.slice(0, 100);
  }
  return criteria;
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
      answerSection: parseAnswerSection(input.answers.answer_section),
    },
  };
}

function parseAnswerSection(input: unknown): string | null {
  if (!isRecord(input) || typeof input.choice !== "string") return null;
  return input.choice === "none" ? null : input.choice;
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
