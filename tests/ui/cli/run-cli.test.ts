import assert from "node:assert/strict";
import { test } from "bun:test";

import type { Interface } from "node:readline/promises";

import {
  HarnessHooks,
  type AgentHarness,
  type AgentMessage,
  type HarnessEvent,
  type SessionMetadata,
} from "../../../src/core/harness/index.js";
import type { ModelConfig } from "../../../src/core/ai/index.js";
import {
  ApplicationRuntime,
  type Project,
  type UserInteraction,
} from "../../../src/coding-agent/index.js";

import { runCli, type RunCliOptions } from "../../../src/ui/cli/run-cli.js";

const MODEL: ModelConfig = { provider: "openai", model: "gpt-5" };

function asHarness(harness: FakeHarnessState): AgentHarness {
  return harness as unknown as AgentHarness;
}

/** Test-only fake Harness; cast to the public type, no production interface. */
interface FakeHarnessState {
  readonly sessionId: string;
  readonly hooks: AgentHarness["hooks"];
  model: ModelConfig;
  readonly messages: readonly AgentMessage[];
  isRunning: boolean;
  prompt: (input: string) => Promise<void>;
  switchModel: (model: ModelConfig) => Promise<void>;
  abort: () => void;
  subscribe: (listener: (event: HarnessEvent) => void) => () => void;
  readonly promptCalls: string[];
  readonly switchModelCalls: ModelConfig[];
  abortCalls: number;
  subscribeCalls: number;
  unsubscribeCalls: number;
}

function makeHarness(
  id: string,
  options: {
    readonly model?: ModelConfig;
    readonly messages?: readonly AgentMessage[];
    readonly isRunning?: boolean;
  } = {},
): FakeHarnessState {
  const harness: FakeHarnessState = {
    sessionId: `session-${id}`,
    hooks: new HarnessHooks(),
    model: options.model ?? MODEL,
    messages: options.messages ?? [],
    isRunning: options.isRunning ?? false,
    prompt: async () => {},
    switchModel: async () => {},
    abort: () => {},
    subscribe: () => () => {},
    promptCalls: [],
    switchModelCalls: [],
    abortCalls: 0,
    subscribeCalls: 0,
    unsubscribeCalls: 0,
  };
  harness.prompt = async (input) => { harness.promptCalls.push(input); };
  harness.switchModel = async (model) => {
    harness.model = model;
    harness.switchModelCalls.push(model);
  };
  harness.abort = () => { harness.abortCalls += 1; };
  harness.subscribe = () => {
    harness.subscribeCalls += 1;
    return () => { harness.unsubscribeCalls += 1; };
  };
  return harness;
}

function makeProject(options: {
  readonly models?: readonly ModelConfig[];
  readonly listSessions?: () => Promise<readonly SessionMetadata[]>;
  readonly createHarness?: () => Promise<AgentHarness>;
  readonly createHarnessFromSession?: (sessionId: string) => Promise<AgentHarness>;
  readonly bindUserInteraction?: (interaction: UserInteraction) => void;
} = {}): Project {
  const models = options.models ?? [MODEL];
  const configured = (model: { readonly provider: string; readonly model: string }): boolean =>
    models.some(
      (candidate) => candidate.provider === model.provider && candidate.model === model.model,
    );
  return {
    listSessions: options.listSessions ?? (async () => []),
    createHarness: options.createHarness ?? (async () => {
      throw new Error("no harness");
    }),
    createHarnessFromSession: options.createHarnessFromSession ?? (async () => {
      throw new Error("no session");
    }),
    bindUserInteraction: options.bindUserInteraction ?? (() => {}),
    modelOptions: () => models.map((model) => ({ provider: model.provider, model: model.model })),
    isConfiguredModel: configured,
    switchModel: async (
      harness: AgentHarness,
      selection: { readonly provider: string; readonly model: string },
    ) => {
      if (!configured(selection)) {
        throw new Error(`model ${selection.provider}/${selection.model} is not configured`);
      }
      if (harness.model.provider === selection.provider && harness.model.model === selection.model) {
        return;
      }
      await harness.switchModel(selection);
    },
  } as unknown as Project;
}

function makeReadline(
  answers: readonly string[],
): { readonly readline: Interface; readonly calls: string[] } {
  const queue = [...answers];
  const calls: string[] = [];
  const readline = {
    question: async (prompt: string): Promise<string> => {
      calls.push(prompt.startsWith("\n⚠") ? "question:permission" : `question:${prompt}`);
      return queue.shift() ?? "/exit";
    },
    close: () => {},
  } as unknown as Interface;
  return { readline, calls };
}

function runUi(runtime: ApplicationRuntime, options: {
  readonly readline: Interface;
  readonly calls: string[];
  readonly write?: (text: string) => void;
}): Promise<void> {
  const runOptions: RunCliOptions = {
    thinking: "hidden",
    toolDetails: "compact",
    color: false,
    readline: options.readline,
    write: options.write ?? ((text) => options.calls.push(`render:${text}`)),
    log: () => {},
    reportError: (error) => options.calls.push(`error:${String(error)}`),
  };
  return runCli(runtime, runOptions);
}

function session(id: string, title: string, updatedAt: string): SessionMetadata {
  return {
    id,
    title,
    cwd: "/repo",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt,
  };
}

test("runCli binds its Interaction before prompting", async () => {
  const answers = ["hello", "1", "/exit"];
  const calls: string[] = [];
  let bound: UserInteraction | undefined;
  const readline = {
    question: async (prompt: string): Promise<string> => {
      calls.push(prompt.includes("Selection?") ? "question:permission" : `question:${prompt}`);
      return answers.shift() ?? "/exit";
    },
    close: () => {},
  } as unknown as Interface;
  const harness = makeHarness("1");
  harness.prompt = async () => {
    assert.ok(bound, "runCli must bind before prompting");
    const answer = await bound.select("needs approval", ["Allow", "Deny"]);
    assert.equal(answer, 0);
  };
  const project = makeProject({
    bindUserInteraction: (interaction) => { bound = interaction; },
  });
  const runtime = new ApplicationRuntime(project, asHarness(harness));

  await runCli(runtime, {
    thinking: "hidden",
    toolDetails: "compact",
    color: false,
    readline,
    write: () => {},
    log: () => {},
    reportError: (error) => calls.push(`error:${String(error)}`),
  });

  assert.ok(bound);
  assert.deepEqual(calls, [
    "question:kea> ",
    "question:permission",
    "question:kea> ",
  ]);
});

test("runCli cleans terminal resources before returning", async () => {
  let closeCalls = 0;
  const readline = {
    question: async (): Promise<string> => "/exit",
    close: () => { closeCalls += 1; },
  } as unknown as Interface;
  const harness = makeHarness("1");
  const runtime = new ApplicationRuntime(makeProject(), asHarness(harness));
  const sigintListeners = process.listenerCount("SIGINT");

  await runCli(runtime, {
    thinking: "hidden",
    toolDetails: "compact",
    color: false,
    readline,
    write: () => {},
    log: () => {},
    reportError: () => {},
  });

  assert.equal(closeCalls, 1);
  assert.equal(harness.subscribeCalls, 1);
  assert.equal(harness.unsubscribeCalls, 1);
  assert.equal(process.listenerCount("SIGINT"), sigintListeners);
});

test("runCli cleans terminal resources when the prompt reader fails", async () => {
  let closeCalls = 0;
  const readline = {
    question: async (): Promise<string> => { throw new Error("read failed"); },
    close: () => { closeCalls += 1; },
  } as unknown as Interface;
  const harness = makeHarness("1");
  const runtime = new ApplicationRuntime(makeProject(), asHarness(harness));
  const sigintListeners = process.listenerCount("SIGINT");

  await assert.rejects(
    runCli(runtime, {
      thinking: "hidden",
      toolDetails: "compact",
      color: false,
      readline,
      write: () => {},
      log: () => {},
      reportError: () => {},
    }),
    /read failed/u,
  );

  assert.equal(closeCalls, 1);
  assert.equal(harness.unsubscribeCalls, 1);
  assert.equal(process.listenerCount("SIGINT"), sigintListeners);
});

test("the outer loop waits for a Run before reading the next Prompt", async () => {
  const { readline, calls } = makeReadline(["hello", "o", "/exit"]);
  const uiOptions = ({
    readline,
    calls,
    write: () => {},
  });

  const harness = makeHarness("1");
  let interaction: UserInteraction | undefined;
  const project = makeProject({
    createHarness: async () => asHarness(harness),
    bindUserInteraction: (bound) => { interaction = bound; },
  });
  const runtime = new ApplicationRuntime(project, asHarness(harness));
  harness.prompt = async () => {
    calls.push("prompt:start");
    assert.ok(interaction, "runCli must bind before prompting");
    await interaction.select(
      "⚠ needs approval\n   rm -rf /tmp/x",
      ["Allow once", "Always allow", "Deny"],
    );
    calls.push("prompt:end");
  };

  await runUi(runtime, uiOptions);

  assert.deepEqual(calls, [
    "question:kea> ",
    "prompt:start",
    "question:permission",
    "prompt:end",
    "question:kea> ",
  ]);
});

test("/new creates a Harness and activates it", async () => {
  const { readline, calls } = makeReadline(["/new", "/exit"]);
  const uiOptions = ({ readline, calls });

  const initial = makeHarness("1");
  const created = makeHarness("2");
  const project = makeProject({ createHarness: async () => asHarness(created) });

  const runtime = new ApplicationRuntime(project, asHarness(initial));
  await runUi(runtime, uiOptions);

  assert.equal(initial.subscribeCalls, 1);
  assert.equal(initial.unsubscribeCalls, 1);
  assert.equal(created.subscribeCalls, 1);
  assert.equal(created.unsubscribeCalls, 1);
});

test("a prompt after /new is sent to the new current Harness", async () => {
  const { readline, calls } = makeReadline(["/new", "hello", "/exit"]);
  const uiOptions = ({ readline, calls });
  const initial = makeHarness("1");
  const created = makeHarness("2");
  const project = makeProject({ createHarness: async () => asHarness(created) });

  const runtime = new ApplicationRuntime(project, asHarness(initial));
  await runUi(runtime, uiOptions);

  assert.deepEqual(initial.promptCalls, []);
  assert.deepEqual(created.promptCalls, ["hello"]);
});

test("/session lists newest-first and restores the numbered choice", async () => {
  const { readline, calls } = makeReadline(["/session", "2", "/exit"]);
  const uiOptions = ({ readline, calls });

  const initial = makeHarness("1");
  let restoredFrom: string | undefined;
  const restored = makeHarness("restored", {
    messages: [{ role: "user", content: "earlier question" }],
  });
  const project = makeProject({
    listSessions: async () => [
      session("newest-id", "newest", "2026-08-18T12:00:00.000Z"),
      session("older-id", "older", "2026-08-17T12:00:00.000Z"),
    ],
    createHarnessFromSession: async (sessionId) => {
      restoredFrom = sessionId;
      return asHarness(restored);
    },
  });

  const runtime = new ApplicationRuntime(project, asHarness(initial));
  await runUi(runtime, uiOptions);

  assert.equal(restoredFrom, "older-id");
  assert.equal(initial.unsubscribeCalls, 1);
  assert.equal(restored.subscribeCalls, 1);
  assert.equal(restored.unsubscribeCalls, 1);
  const text = calls.filter((call) => call.startsWith("render:")).join("");
  assert.ok(text.includes("Sessions (newest first):"), text);
  assert.ok(text.indexOf("1. newest") < text.indexOf("2. older"), text);
  assert.ok(text.includes("Session session-restored"), text);
  assert.ok(text.includes("earlier question"), text);
});

test("a failed Session activation keeps the old Harness active", async () => {
  const { readline, calls } = makeReadline(["/session", "1", "/exit"]);
  const uiOptions = ({ readline, calls });

  const initial = makeHarness("1");
  const project = makeProject({
    listSessions: async () => [session("id-1", "only", "2026-08-18T12:00:00.000Z")],
    createHarnessFromSession: async () => {
      throw new Error("storage failure");
    },
  });

  const runtime = new ApplicationRuntime(project, asHarness(initial));
  await runUi(runtime, uiOptions);

  assert.ok(calls.includes("error:Error: storage failure"), calls.join(" | "));
  assert.equal(initial.subscribeCalls, 1);
  assert.equal(initial.unsubscribeCalls, 1);
});

test("/model groups by provider and switches to the chosen model", async () => {
  const models: readonly ModelConfig[] = [
    { provider: "openai", model: "gpt-5" },
    { provider: "openai", model: "gpt-5-mini" },
    { provider: "anthropic", model: "claude-4" },
  ];
  const { readline, calls } = makeReadline(["/model", "2", "1", "/exit"]);
  const uiOptions = ({ readline, calls });

  const harness = makeHarness("1");
  const project = makeProject({ models, createHarness: async () => asHarness(harness) });

  const runtime = new ApplicationRuntime(project, asHarness(harness));
  await runUi(runtime, uiOptions);

  assert.deepEqual(harness.switchModelCalls, [{ provider: "anthropic", model: "claude-4" }]);
  assert.equal(harness.model.provider, "anthropic");
  const text = calls.filter((call) => call.startsWith("render:")).join("");
  assert.ok(text.includes("Providers:"), text);
  assert.ok(text.includes("Models for anthropic:"), text);
});

test("/model selecting the current model is a no-op", async () => {
  const models: readonly ModelConfig[] = [
    { provider: "openai", model: "gpt-5" },
    { provider: "openai", model: "gpt-5-mini" },
  ];
  const { readline, calls } = makeReadline(["/model", "1", "1", "/exit"]);
  const uiOptions = ({ readline, calls });

  const harness = makeHarness("1");
  const project = makeProject({ models, createHarness: async () => asHarness(harness) });

  const runtime = new ApplicationRuntime(project, asHarness(harness));
  await runUi(runtime, uiOptions);

  assert.deepEqual(harness.switchModelCalls, []);
});

test("/model cancels at either step without changing the model", async () => {
  const models: readonly ModelConfig[] = [
    { provider: "openai", model: "gpt-5" },
    { provider: "anthropic", model: "claude-4" },
  ];
  const { readline, calls } = makeReadline(["/model", "", "/model", "1", "", "/exit"]);
  const uiOptions = ({ readline, calls });

  const harness = makeHarness("1");
  const project = makeProject({ models, createHarness: async () => asHarness(harness) });

  const runtime = new ApplicationRuntime(project, asHarness(harness));
  await runUi(runtime, uiOptions);

  assert.deepEqual(harness.switchModelCalls, []);
});

test("an initial unavailable model asks for a configured model before the prompt loop", async () => {
  const models: readonly ModelConfig[] = [{ provider: "anthropic", model: "claude-4" }];
  const { readline, calls } = makeReadline(["1", "/exit"]);
  const uiOptions = ({ readline, calls });

  const restored = makeHarness("restored", {
    model: { provider: "openai", model: "gone" },
  });
  const project = makeProject({ models, createHarness: async () => asHarness(restored) });

  const runtime = new ApplicationRuntime(project, asHarness(restored));
  await runUi(runtime, uiOptions);

  assert.deepEqual(restored.switchModelCalls, [{ provider: "anthropic", model: "claude-4" }]);
  assert.equal(restored.subscribeCalls, 1);
  const text = calls.filter((call) => call.startsWith("render:")).join("");
  assert.ok(text.includes("model openai/gone is not configured"), text);
});

test("a switched Session blocks prompts until its unavailable model is repaired", async () => {
  const replacement: ModelConfig = { provider: "anthropic", model: "claude-4" };
  const models: readonly ModelConfig[] = [MODEL, replacement];
  const { readline, calls } = makeReadline([
    "/session", "1", "", "blocked",
    "/model", "2", "1", "allowed", "/exit",
  ]);
  const uiOptions = ({ readline, calls });
  const initial = makeHarness("initial");
  const restored = makeHarness("restored", {
    model: { provider: "openai", model: "gone" },
  });
  const project = makeProject({
    models,
    listSessions: async () => [session("restored-id", "restored", "2026-08-18T00:00:00.000Z")],
    createHarnessFromSession: async () => asHarness(restored),
  });

  const runtime = new ApplicationRuntime(project, asHarness(initial));
  await runUi(runtime, uiOptions);

  assert.deepEqual(restored.promptCalls, ["allowed"]);
  assert.deepEqual(restored.switchModelCalls, [replacement]);
  const text = calls.filter((call) => call.startsWith("render:")).join("");
  assert.ok(
    text.includes("current model is not configured; use /model before prompting"),
    text,
  );
});

test("blank input at the prompt is skipped without prompting the Harness", async () => {
  const { readline, calls } = makeReadline(["", "hi", "/exit"]);
  const uiOptions = ({ readline, calls, write: () => {} });
  const harness = makeHarness("1");
  const project = makeProject({ createHarness: async () => asHarness(harness) });

  const runtime = new ApplicationRuntime(project, asHarness(harness));
  await runUi(runtime, uiOptions);

  assert.deepEqual(harness.promptCalls, ["hi"]);
});

test("cancelling the initial model repair exits without the prompt loop", async () => {
  const models: readonly ModelConfig[] = [{ provider: "anthropic", model: "claude-4" }];
  const { readline, calls } = makeReadline([""]);
  const uiOptions = ({ readline, calls });

  const restored = makeHarness("restored", {
    model: { provider: "openai", model: "gone" },
  });
  const project = makeProject({ models, createHarness: async () => asHarness(restored) });

  const runtime = new ApplicationRuntime(project, asHarness(restored));
  await runUi(runtime, uiOptions);

  assert.equal(restored.switchModelCalls.length, 0);
  assert.equal(restored.subscribeCalls, 0);
  assert.deepEqual(
    calls.filter((call) => call.startsWith("question:")),
    ["question:Model number? "],
  );
});

test("EOF at the prompt exits the loop", async () => {
  const calls: string[] = [];
  const readline = {
    question: async (prompt: string): Promise<string> => {
      calls.push(`question:${prompt}`);
      throw Object.assign(new Error("EOF"), { name: "AbortError" });
    },
    close: () => {},
  } as unknown as Interface;
  const uiOptions = ({ readline, calls });

  const harness = makeHarness("1");
  const project = makeProject({ createHarness: async () => asHarness(harness) });

  const runtime = new ApplicationRuntime(project, asHarness(harness));
  await runUi(runtime, uiOptions);

  assert.deepEqual(
    calls.filter((call) => call.startsWith("question:")),
    ["question:kea> "],
  );
});

test("command errors render and the loop continues", async () => {
  const { readline, calls } = makeReadline(["/new extra", "/exit"]);
  const uiOptions = ({ readline, calls });

  const harness = makeHarness("1");
  const project = makeProject({ createHarness: async () => asHarness(harness) });

  const runtime = new ApplicationRuntime(project, asHarness(harness));
  await runUi(runtime, uiOptions);

  assert.ok(
    calls.some((call) => call === "render:\n✗ /new does not accept arguments\n"),
    calls.join(" | "),
  );
  assert.deepEqual(
    calls.filter((call) => call.startsWith("question:")),
    ["question:kea> ", "question:kea> "],
  );
});

test("Prompt failures report and the loop continues", async () => {
  const { readline, calls } = makeReadline(["hello", "/exit"]);
  const uiOptions = ({ readline, calls });

  const harness = makeHarness("1");
  harness.prompt = async () => {
    throw new Error("model unavailable");
  };
  const project = makeProject({ createHarness: async () => asHarness(harness) });

  const runtime = new ApplicationRuntime(project, asHarness(harness));
  await runUi(runtime, uiOptions);

  assert.ok(calls.includes("error:Error: model unavailable"), calls.join(" | "));
  assert.deepEqual(
    calls.filter((call) => call.startsWith("question:")),
    ["question:kea> ", "question:kea> "],
  );
});

test("SIGINT during a Run calls abort on the current Harness", async () => {
  const { readline, calls } = makeReadline(["hello", "/exit"]);
  const uiOptions = ({ readline, calls });

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const harness = makeHarness("1");
  harness.isRunning = true;
  harness.prompt = async () => {
    calls.push("prompt:started");
    await gate;
  };
  const project = makeProject({ createHarness: async () => asHarness(harness) });

  const runtime = new ApplicationRuntime(project, asHarness(harness));
  const runPromise = runUi(runtime, uiOptions);
  try {
    for (let attempt = 0; attempt < 100 && !calls.includes("prompt:started"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(calls.includes("prompt:started"), "prompt never started");
    process.emit("SIGINT");
    assert.equal(harness.abortCalls, 1);
    release();
    await runPromise;
    assert.equal(harness.abortCalls, 1);
  } finally {
    release();
    await runPromise;
  }
});

