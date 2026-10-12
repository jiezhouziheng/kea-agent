import assert from "node:assert/strict";
import { test } from "bun:test";

import {
  HarnessHooks,
  type AgentHarness,
  type HarnessEvent,
} from "../../src/core/harness/index.js";
import { ApplicationRuntime, type Project } from "../../src/coding-agent/index.js";
import type { UserInteraction } from "../../src/coding-agent/user-interaction.js";

type HarnessListener = Parameters<AgentHarness["subscribe"]>[0];

function makeHarness(id: string, isRunning = false) {
  const listeners = new Set<HarnessListener>();
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  const harness = {
    sessionId: id,
    isRunning,
    hooks: new HarnessHooks(),
    subscribe(listener: HarnessListener) {
      subscribeCalls += 1;
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        unsubscribeCalls += 1;
        listeners.delete(listener);
      };
    },
  } as unknown as AgentHarness;

  return {
    harness,
    emit(event: HarnessEvent) {
      for (const listener of listeners) void listener(event);
    },
    subscribeCalls: () => subscribeCalls,
    unsubscribeCalls: () => unsubscribeCalls,
  };
}

function makeProject(options: {
  readonly created?: AgentHarness;
  readonly restored?: AgentHarness;
  readonly createError?: Error;
  readonly restoreError?: Error;
  readonly restoredIds?: string[];
  readonly createCalls?: { count: number };
}): Project {
  return {
    bindUserInteraction: () => {},
    createHarness: async () => {
      if (options.createCalls !== undefined) options.createCalls.count += 1;
      if (options.createError !== undefined) throw options.createError;
      if (options.created === undefined) throw new Error("missing created Harness");
      return options.created;
    },
    createHarnessFromSession: async (sessionId: string) => {
      options.restoredIds?.push(sessionId);
      if (options.restoreError !== undefined) throw options.restoreError;
      if (options.restored === undefined) throw new Error("missing restored Harness");
      return options.restored;
    },
  } as unknown as Project;
}

const EVENT = { type: "run-start" } as HarnessEvent;

const allowingInteraction: UserInteraction = {
  async select() { return 0; },
  async confirm() { return true; },
  async input() { return "value"; },
};

test("bindUserInteraction delegates the application binding to Project", () => {
  const initial = makeHarness("initial");
  const bindings: UserInteraction[] = [];
  const project = {
    bindUserInteraction(interaction: UserInteraction) {
      bindings.push(interaction);
    },
  } as unknown as Project;
  const runtime = new ApplicationRuntime(project, initial.harness);

  runtime.bindUserInteraction(allowingInteraction);

  assert.deepEqual(bindings, [allowingInteraction]);
});

test("newSession creates through Project and replaces current", async () => {
  const initial = makeHarness("initial");
  const created = makeHarness("created");
  const createCalls = { count: 0 };
  const project = makeProject({
    created: created.harness,
    createCalls,
  });
  const runtime = new ApplicationRuntime(project, initial.harness);

  assert.equal(runtime.project, project);
  assert.equal(runtime.current, initial.harness);
  assert.equal(await runtime.newSession(), created.harness);
  assert.equal(runtime.current, created.harness);
  assert.equal(createCalls.count, 1);
});

test("switchSession restores the requested Session through Project", async () => {
  const initial = makeHarness("initial");
  const restored = makeHarness("restored");
  const restoredIds: string[] = [];
  const runtime = new ApplicationRuntime(
    makeProject({
      restored: restored.harness,
      restoredIds,
    }),
    initial.harness,
  );

  assert.equal(await runtime.switchSession("session-2"), restored.harness);
  assert.deepEqual(restoredIds, ["session-2"]);
  assert.equal(runtime.current, restored.harness);
});

test("subscribe follows successful Session replacement", async () => {
  const initial = makeHarness("initial");
  const created = makeHarness("created");
  const runtime = new ApplicationRuntime(
    makeProject({ created: created.harness }),
    initial.harness,
  );
  const received: HarnessEvent[] = [];
  const unsubscribe = runtime.subscribe((event) => received.push(event));

  initial.emit(EVENT);
  await runtime.newSession();
  initial.emit(EVENT);
  created.emit(EVENT);

  assert.deepEqual(received, [EVENT, EVENT]);
  assert.equal(initial.subscribeCalls(), 1);
  assert.equal(initial.unsubscribeCalls(), 1);
  assert.equal(created.subscribeCalls(), 1);

  unsubscribe();
  unsubscribe();
  created.emit(EVENT);
  assert.deepEqual(received, [EVENT, EVENT]);
  assert.equal(created.unsubscribeCalls(), 1);
});

test("failed Project creation preserves current and subscriptions", async () => {
  const initial = makeHarness("initial");
  const runtime = new ApplicationRuntime(
    makeProject({
      createError: new Error("storage failure"),
    }),
    initial.harness,
  );
  const received: HarnessEvent[] = [];
  runtime.subscribe((event) => received.push(event));

  await assert.rejects(runtime.newSession(), /storage failure/);
  initial.emit(EVENT);

  assert.equal(runtime.current, initial.harness);
  assert.deepEqual(received, [EVENT]);
  assert.equal(initial.unsubscribeCalls(), 0);
});

test("Session replacement is rejected before Project access while current is running", async () => {
  const initial = makeHarness("initial", true);
  const created = makeHarness("created");
  const createCalls = { count: 0 };
  const runtime = new ApplicationRuntime(
    makeProject({
      created: created.harness,
      restored: created.harness,
      createCalls,
    }),
    initial.harness,
  );

  await assert.rejects(runtime.newSession(), /running/i);
  await assert.rejects(runtime.switchSession("session-2"), /running/i);
  assert.equal(createCalls.count, 0);
  assert.equal(runtime.current, initial.harness);
});

test("close detaches subscriptions once and rejects later use", async () => {
  const initial = makeHarness("initial");
  const runtime = new ApplicationRuntime(
    makeProject({}),
    initial.harness,
  );
  runtime.subscribe(() => {});

  runtime.close();
  runtime.close();

  assert.equal(initial.unsubscribeCalls(), 1);
  assert.throws(() => runtime.subscribe(() => {}), /closed/i);
  await assert.rejects(runtime.newSession(), /closed/i);
  await assert.rejects(runtime.switchSession("session-2"), /closed/i);
});
