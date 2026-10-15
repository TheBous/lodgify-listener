import assert from "node:assert/strict";
import test from "node:test";
import { type ConversationState, emptyState } from "./contracts.js";
import { event, harness } from "./fixtures.test.js";
import { handleJobFailure, processJob } from "./processing.js";
import { enqueue } from "./state.js";

function preparing(): ConversationState {
  return { ...emptyState(), job: { kind: "prepare", events: [event()], attempts: 0 } };
}

test("groups arrivals into one answer; fresh arrival invalidates an unsent answer", async () => {
  const state = preparing();
  const setup = harness();
  const options = { state, dependencies: setup.dependencies, dryRun: false, save: async () => {} };
  await processJob(options);
  assert.equal((await enqueue(state, { ...event("2"), message: "And parking?" })).status, 202);
  assert.equal(state.job, null);
  assert.equal(state.pending.length, 2);
  state.job = { kind: "prepare", events: state.pending, attempts: 0 };
  state.pending = [];
  await processJob(options);
  await processJob(options);
  assert.equal(setup.sent.length, 1);
  assert.equal(setup.generated[1]?.length, 2);
});

test("human escalation sends courtesy, pauses, then only notifies on new messages", async () => {
  const state = preparing();
  const setup = harness({ escalation: "umano", reply: "Our team will message you shortly." });
  const options = { state, dependencies: setup.dependencies, dryRun: false, save: async () => {} };
  await processJob(options);
  await processJob(options);
  assert.equal(state.mode, "human");
  await processJob(options);
  state.job = { kind: "prepare", events: [event("2")], attempts: 0 };
  await processJob(options);
  await processJob(options);
  assert.equal(setup.sent.length, 1);
  assert.equal(setup.notices.length, 2);
  assert.equal(setup.generated.length, 1);
});

test("notification keeps assistant active; dry run never sends", async () => {
  for (const dryRun of [false, true]) {
    const state = preparing();
    const setup = harness({ escalation: "notifica", reply: "We will check availability." });
    const options = { state, dependencies: setup.dependencies, dryRun, save: async () => {} };
    await processJob(options);
    await processJob(options);
    await processJob(options);
    assert.equal(state.mode, "auto");
    assert.equal(setup.sent.length, dryRun ? 0 : 1);
    assert.equal(setup.notices.length, 1);
  }
});

test("enquiries, pending bookings and owner replies never generate an answer", async () => {
  for (const reason of ["enquiry", "pending", "owner"]) {
    const state = preparing();
    const setup = harness();
    assert.ok(state.job);
    if (reason === "enquiry") state.job.events[0] = { ...event(), bookingId: "E123" };
    if (reason === "pending") setup.currentContext.booking.status = "Tentative";
    if (reason === "owner")
      setup.currentContext.history.push({
        from: "Owner",
        text: "I will handle this",
        sentAt: new Date(Date.now() + 1000).toISOString(),
      });
    const options = {
      state,
      dependencies: setup.dependencies,
      dryRun: false,
      save: async () => {},
    };
    await processJob(options);
    await processJob(options);
    assert.equal(setup.generated.length, 0);
    assert.equal(setup.sent.length, 0);
    assert.equal(setup.notices.length, 1);
  }
});

test("a changed thread cancels a drafted answer", async () => {
  const state = preparing();
  const setup = harness();
  const options = { state, dependencies: setup.dependencies, dryRun: false, save: async () => {} };
  await processJob(options);
  setup.currentContext.fingerprint = "owner-intervened";
  await processJob(options);
  assert.equal(state.mode, "human");
  assert.equal(setup.sent.length, 0);
});

test("ambiguous sends keep UUID and reply across restart; three failures escalate", async () => {
  let state = preparing();
  const setup = harness();
  await processJob({
    state,
    dependencies: setup.dependencies,
    dryRun: false,
    save: async () => {},
  });
  const ids: string[] = [];
  setup.dependencies.send = async (job) => {
    ids.push(job.replyId);
    throw new Error("timeout");
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    let saved = structuredClone(state);
    await assert.rejects(
      processJob({
        state,
        dependencies: setup.dependencies,
        dryRun: false,
        save: async () => {
          saved = structuredClone(state);
        },
      }),
    );
    assert.equal(saved.job?.kind, "deliver");
    if (saved.job?.kind === "deliver") assert.equal(saved.job.submitted, true);
    handleJobFailure(state, new Error("timeout"));
    state = structuredClone(state);
  }
  assert.equal(new Set(ids).size, 1);
  assert.equal(state.mode, "human");
  assert.equal(state.job?.kind, "notify");
  if (state.job?.kind === "notify") assert.match(state.job.text, /ESITO INVIO INCERTO/);
});

test("three generation failures notify without fabricating a guest reply", async () => {
  const state = preparing();
  const setup = harness();
  setup.dependencies.generate = async () => {
    throw new Error("unavailable");
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(
      processJob({ state, dependencies: setup.dependencies, dryRun: false, save: async () => {} }),
    );
    handleJobFailure(state, new Error("unavailable"));
  }
  assert.equal(state.mode, "human");
  assert.equal(state.job?.kind, "notify");
  assert.equal(setup.sent.length, 0);
});
