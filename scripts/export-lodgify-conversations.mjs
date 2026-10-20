import { writeFile } from "node:fs/promises";

const apiKey = process.env.LODGIFY_API_KEY;
if (!apiKey) {
  console.error("Set LODGIFY_API_KEY in the environment; do not put it in this file.");
  process.exit(1);
}

const baseUrl = "https://api.lodgify.com";
const pageSize = 50;
const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
const headers = { "X-ApiKey": apiKey, accept: "application/json" };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GET ${path} failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

function cleanText(value) {
  return typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

const bookings = [];
for (let page = 1; ; page += 1) {
  const result = await getJson(
    `/v2/reservations/bookings?page=${page}&size=${pageSize}&stayFilter=All`,
  );
  const items = Array.isArray(result) ? result : result.items;
  if (!Array.isArray(items) || items.length === 0) break;
  bookings.push(...items);
  if (items.length < pageSize) break;
  await pause(300);
}

const seenThreads = new Set();
const conversations = [];
let skipped = 0;

for (const item of bookings) {
  if (!Number.isInteger(item?.id)) {
    skipped += 1;
    continue;
  }

  try {
    const booking = await getJson(`/v1/reservation/booking/${item.id}`);
    const threadUid = booking?.thread_uid;
    if (typeof threadUid !== "string" || seenThreads.has(threadUid)) {
      skipped += 1;
      continue;
    }
    seenThreads.add(threadUid);

    const rawThread = await getJson(`/v2/messaging/${encodeURIComponent(threadUid)}`);
    const thread = Array.isArray(rawThread)
      ? (rawThread.find((entry) => entry?.thread_uid === threadUid) ?? rawThread[0])
      : rawThread;
    const messages = Array.isArray(thread?.messages) ? thread.messages : [];
    const selected = messages
      .filter((message) => ["Renter", "Owner"].includes(message?.type))
      .map((message) => ({
        from: message.type === "Renter" ? "guest" : "host",
        sentAt: message.date_created ?? null,
        text: cleanText(message.message),
      }))
      .filter((message) => {
        const date = Date.parse(message.sentAt ?? "");
        return Number.isFinite(date) && date >= cutoff && message.text.length > 0;
      });

    if (selected.some((message) => message.from === "guest")) {
      conversations.push({
        bookingId: booking.id,
        property: booking.property_name ?? null,
        source: booking.source ?? null,
        messages: selected,
      });
    }
  } catch (error) {
    skipped += 1;
    console.error(`Skipped booking ${item.id}: ${error.message}`);
  }

  await pause(300);
}

const outputPath = "/tmp/lodgify-conversations-last-365-days.json";
await writeFile(outputPath, `${JSON.stringify(conversations, null, 2)}\n`, { mode: 0o600 });
console.log(
  `Saved ${conversations.length} conversations to ${outputPath}; ${skipped} bookings/threads skipped.`,
);
console.log(
  "The export excludes guest names and email addresses, but message text may still contain personal details.",
);
