import assert from "node:assert/strict";
import test from "node:test";
import { type ConversationState, emptyState } from "./contracts.js";
import { event, harness } from "./fixtures.test.js";
import { handleJobFailure, processJob } from "./processing.js";
import { enqueue } from "./state.js";

test("reconciles an accepted message after restart using Lodgify message_id", async () => {
  const setup = harness();
  const state: ConversationState = {
    ...emptyState(),
    job: { kind: "prepare", events: [event()], attempts: 0 },
  };
  const options = { state, dependencies: setup.dependencies, dryRun: false, save: async () => {} };
  await processJob(options);
  assert.ok(state.job?.kind === "deliver");
  state.job.submitted = true;
  setup.currentContext.outbound.push({ id: state.job.replyId, status: "Delivered" });
  setup.currentContext.fingerprint = "now-includes-our-reply";
  await processJob(options);
  assert.equal(state.job, null);
  assert.equal(setup.sent.length, 0);
  assert.equal(state.mode, "auto");
});

test("Submitted and Failed receipts never trigger a second POST", async () => {
  for (const status of ["Submitted", "Failed", null]) {
    const setup = harness();
    const state: ConversationState = {
      ...emptyState(),
      job: { kind: "prepare", events: [event()], attempts: 0 },
    };
    const options = {
      state,
      dependencies: setup.dependencies,
      dryRun: false,
      save: async () => {},
    };
    await processJob(options);
    assert.ok(state.job?.kind === "deliver");
    state.job.submitted = true;
    setup.currentContext.outbound.push({ id: state.job.replyId, status });
    await assert.rejects(processJob(options), /verify Lodgify/);
    assert.equal(setup.sent.length, 0);
  }
});

test("new arrivals merge with a generation retry, but cannot replace an uncertain send", async () => {
  let state: ConversationState = {
    ...emptyState(),
    job: { kind: "prepare", events: [event()], attempts: 1 },
  };
  await enqueue(state, event("2"));
  assert.equal(state.job, null);
  assert.equal(state.pending.length, 2);
  const setup = harness();
  state.job = { kind: "prepare", events: state.pending, attempts: 0 };
  state.pending = [];
  await processJob({
    state,
    dependencies: setup.dependencies,
    dryRun: false,
    save: async () => {},
  });
  state = structuredClone(state);
  assert.ok(state.job?.kind === "deliver");
  state.job.submitted = true;
  const replyId = state.job.replyId;
  await enqueue(state, event("3"));
  assert.equal(state.job.replyId, replyId);
  assert.equal(state.pending.length, 1);
});

test("failed Telegram job remains recoverable after three attempts", () => {
  const state: ConversationState = {
    ...emptyState(),
    job: { kind: "notify", events: [event()], text: "Alert", attempts: 0 },
  };
  for (let index = 0; index < 3; index++) handleJobFailure(state, new Error("Telegram failed"));
  assert.equal(state.job?.kind, "notify");
  assert.equal(state.job.attempts, 3);
  assert.equal(state.lastError, "Telegram failed");
});
