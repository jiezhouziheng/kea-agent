import assert from "node:assert/strict";
import { test } from "bun:test";
import { SyntaxStyle, type ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";

import type { ApplicationRuntime } from "../../../src/coding-agent/index.js";
import type {
  AgentMessage,
  HarnessEvent,
  SessionMetadata,
} from "../../../src/core/harness/index.js";
import type { ModelConfig } from "../../../src/core/ai/index.js";
import type { UserInteraction } from "../../../src/coding-agent/index.js";
import { TuiApp } from "../../../src/ui/tui/tui-app.js";

const assistant = (content: string): AgentMessage => ({
  role: "assistant",
  content: [{ type: "text", text: content }],
  model: "sonnet",
  stopReason: "stop",
  latencyMs: 18,
});

function fakeRuntime(history: readonly AgentMessage[]) {
  let listener: ((event: HarnessEvent) => void) | undefined;
  let pendingPrompt: ((reason?: "completed" | "aborted") => void) | undefined;
  const sessions: SessionMetadata[] = [{
    id: "session-a",
    title: "Kea session",
    cwd: "D:\\project",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  }];
  const models: ModelConfig[] = [
    { provider: "anthropic", model: "sonnet" },
    { provider: "anthropic", model: "opus" },
    { provider: "openai", model: "gpt-5" },
  ];
  const tasks: { last: Promise<void> | undefined } = { last: undefined };
  const emitRaw = (event: HarnessEvent) => listener?.(event);
  const harness = {
    sessionId: sessions[0]!.id,
    title: sessions[0]!.title,
    model: { provider: "anthropic", model: "sonnet" },
    messages: history,
    isRunning: false,
    promptCalls: [] as string[],
    abortCalls: 0,
    prompt(text: string): Promise<void> {
      this.promptCalls.push(text);
      this.isRunning = true;
      emitRaw({ type: "run-start", runId: "prompt-run" });
      const task = new Promise<void>((resolve) => {
        pendingPrompt = (reason = "completed") => {
          this.isRunning = false;
          emitRaw({ type: "run-end", runId: "prompt-run", reason });
          resolve();
        };
      });
      tasks.last = task;
      return task;
    },
    abort(): void {
      this.abortCalls += 1;
      if (!this.isRunning) return;
      pendingPrompt?.("aborted");
      pendingPrompt = undefined;
    },
  };
  let current = harness;
  const harnesses = new Map([[harness.sessionId, harness]]);
  let boundInteraction: UserInteraction | undefined;
  const switchModelCalls: ModelConfig[] = [];
  const calls = { newSession: 0, unsubscribe: 0 };
  const switchSessionCalls: string[] = [];
  const runtime = {
    get current() {
      return current;
    },
    project: {
      listSessions: async () => sessions,
      modelOptions: () => models,
      isConfiguredModel: (selection: ModelConfig) => models.some(
        (candidate) => candidate.provider === selection.provider
          && candidate.model === selection.model,
      ),
      async switchModel(candidate: typeof harness, selection: ModelConfig) {
        switchModelCalls.push(selection);
        candidate.model = selection;
      },
    },
    bindUserInteraction(interaction: UserInteraction) {
      boundInteraction = interaction;
    },
    subscribe(next: (event: HarnessEvent) => void) {
      listener = next;
      return () => {
        calls.unsubscribe += 1;
        if (listener === next) listener = undefined;
      };
    },
    async newSession() {
      calls.newSession += 1;
      const metadata: SessionMetadata = {
        id: "session-new",
        title: "New session",
        cwd: "D:\\new",
        createdAt: "2026-08-24T01:00:00.000Z",
        updatedAt: "2026-08-24T01:00:00.000Z",
      };
      sessions.unshift(metadata);
      current = {
        ...harness,
        sessionId: metadata.id,
        title: metadata.title,
        messages: [],
        isRunning: false,
        promptCalls: [],
        abortCalls: 0,
      };
      harnesses.set(current.sessionId, current);
      return current;
    },
    async switchSession(id: string) {
      switchSessionCalls.push(id);
      const candidate = harnesses.get(id);
      if (candidate === undefined) throw new Error(`missing Session ${id}`);
      current = candidate;
      return current;
    },
  } as unknown as ApplicationRuntime;
  return {
    runtime,
    harness,
    sessions,
    models,
    harnesses,
    tasks,
    switchModelCalls,
    switchSessionCalls,
    calls,
    get interaction() {
      return boundInteraction;
    },
    addSession(metadata: SessionMetadata, model: ModelConfig = harness.model) {
      const candidate = {
        ...harness,
        sessionId: metadata.id,
        title: metadata.title,
        model,
        messages: [] as readonly AgentMessage[],
        isRunning: false,
        promptCalls: [] as string[],
        abortCalls: 0,
      };
      sessions.push(metadata);
      harnesses.set(metadata.id, candidate);
      return candidate;
    },
    finishPrompt() {
      act(() => pendingPrompt?.());
      pendingPrompt = undefined;
    },
    async emit(event: HarnessEvent): Promise<void> {
      await act(async () => {
        emitRaw(event);
        await Promise.resolve();
      });
    },
  };
}

async function render(
  history: readonly AgentMessage[],
  options: {
    readonly thinking?: "hidden" | "visible";
    readonly toolDetails?: "compact" | "full";
  } = {},
  existingFake?: ReturnType<typeof fakeRuntime>,
) {
  const fake = existingFake ?? fakeRuntime(history);
  const callbacks = {
    exits: 0,
    tracked: [] as Array<Promise<void> | undefined>,
  };
  let setup!: Awaited<ReturnType<typeof testRender>>;
  await act(async () => {
    setup = await testRender(
      <TuiApp
        runtime={fake.runtime}
        thinking={options.thinking ?? "visible"}
        toolDetails={options.toolDetails ?? "compact"}
        redact={(message) => message}
        onExit={() => {
          callbacks.exits += 1;
        }}
        trackPrompt={(task) => callbacks.tracked.push(task)}
      />,
      { width: 120, height: 32, kittyKeyboard: true, useThread: false },
    );
    await Promise.resolve();
    await setup.flush();
  });
  return { ...fake, setup, callbacks };
}

async function typeAndSubmit(
  setup: Awaited<ReturnType<typeof testRender>>,
  text: string,
): Promise<void> {
  await act(async () => {
    await setup.mockInput.typeText(text);
    setup.mockInput.pressEnter();
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    await setup.flush();
  });
}

async function pressAndFlush(
  setup: Awaited<ReturnType<typeof testRender>>,
  press: () => void,
): Promise<void> {
  await act(async () => {
    press();
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    await setup.flush();
  });
}

test("empty Session renders the Kea frame with real footer data", async () => {
  const { setup } = await render([]);
  try {
    const frame = await setup.waitForFrame(
      (candidate) => candidate.includes("KEA") && candidate.includes("D:\\project"),
    );
    assert.match(frame, /Ask Kea anything/u);
    assert.match(frame, /Kea session/u);
    assert.match(frame, /session-a/u);
    assert.match(frame, /anthropic\/sonnet/u);
    assert.match(frame, /\/help/u);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("empty Session centers the welcome composer", async () => {
  const { setup } = await render([]);
  try {
    const frame = await setup.waitForFrame(
      (candidate) => candidate.includes("KEA") && candidate.includes("Ask Kea anything"),
    );
    const lines = frame.split("\n");
    const logoLine = lines.findIndex((line) => line.includes("KEA"));
    const composerLine = lines.findIndex((line) => line.includes("Ask Kea anything"));

    assert.ok(logoLine >= 8 && logoLine <= 18, `welcome Logo is not centered:\n${frame}`);
    assert.ok(
      composerLine > logoLine && composerLine - logoLine <= 10,
      `welcome composer is detached from the Logo:\n${frame}`,
    );
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("conversation renders user, ordered assistant blocks, Tool facts, and no empty Logo", async () => {
  const history: AgentMessage[] = [
    { role: "user", content: "Inspect the project" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "I found the answer" },
        { type: "thinking", thinking: "checking files" },
        { type: "toolCall", id: "call-a", name: "read_file", arguments: { path: "README.md" } },
      ],
      model: "sonnet",
      stopReason: "toolUse",
      latencyMs: 25,
    },
    {
      role: "tool",
      toolCallId: "call-a",
      name: "read_file",
      content: "file contents",
    },
  ];
  const { setup } = await render(history);
  try {
    const frame = await setup.waitForFrame((candidate) => candidate.includes("file contents"));
    assert.match(frame, /Inspect the project/u);
    assert.match(frame, /I found the answer/u);
    assert.match(frame, /checking files/u);
    assert.match(frame, /read_file/u);
    assert.doesNotMatch(frame, /\bKEA\b/u);

    const transcript = setup.renderer.root.findDescendantById("transcript") as
      | ScrollBoxRenderable
      | undefined;
    assert.equal(transcript?.stickyScroll, true);
    assert.equal(transcript?.stickyStart, "bottom");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("hidden thinking is omitted from stored conversation", async () => {
  const history: AgentMessage[] = [
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private reasoning" },
        { type: "text", text: "public answer" },
      ],
      model: "sonnet",
      stopReason: "stop",
      latencyMs: 10,
    },
  ];
  const { setup } = await render(history, { thinking: "hidden" });
  try {
    const frame = await setup.waitForFrame((candidate) => candidate.includes("public answer"));
    assert.doesNotMatch(frame, /private reasoning/u);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("compact Tool output is bounded while full output remains complete", async () => {
  const longOutput = `${"x".repeat(210)}FULL-TAIL`;
  const history: AgentMessage[] = [{
    role: "tool",
    toolCallId: "call-a",
    name: "bash",
    content: longOutput,
  }];
  const compact = await render(history, { toolDetails: "compact" });
  try {
    const frame = await compact.setup.waitForFrame((candidate) => candidate.includes("Tool bash"));
    assert.doesNotMatch(frame, /FULL-TAIL/u);
  } finally {
    act(() => compact.setup.renderer.destroy());
  }

  const full = await render(history, { toolDetails: "full" });
  try {
    const frame = await full.setup.waitForFrame((candidate) => candidate.includes("FULL-TAIL"));
    assert.match(frame, /FULL-TAIL/u);
  } finally {
    act(() => full.setup.renderer.destroy());
  }
});

test("stream facts stay ordered and turn-end replaces draft output", async () => {
  const { setup, harness, emit } = await render([]);
  try {
    await emit({ type: "run-start", runId: "run-a" });
    Object.assign(harness, {
      title: "Generated title",
      messages: [{ role: "user", content: "hello" } satisfies AgentMessage],
      isRunning: true,
    });
    await emit({ type: "turn-start", runId: "run-a" });
    await emit({ type: "text-delta", runId: "run-a", text: "draft first" });
    await emit({ type: "thinking-delta", runId: "run-a", thinking: "draft thought" });
    await emit({ type: "text-start", runId: "run-a" });
    await emit({ type: "text-delta", runId: "run-a", text: "draft second" });

    const draft = await setup.waitForFrame((candidate) => candidate.includes("draft second"));
    assert.ok(draft.indexOf("draft first") < draft.indexOf("draft thought"));
    assert.ok(draft.indexOf("draft thought") < draft.indexOf("draft second"));

    await emit({
      type: "turn-end",
      runId: "run-a",
      message: assistant("final answer"),
      toolResults: [],
    });
    await emit({ type: "run-end", runId: "run-a", reason: "completed" });
    const final = await setup.waitForFrame((candidate) => candidate.includes("final answer"));
    assert.doesNotMatch(final, /draft first|draft thought|draft second/u);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("composer submits one Prompt, prevents queuing, and Ctrl+C requests TUI exit", async () => {
  const view = await render([]);
  try {
    await typeAndSubmit(view.setup, "hello from TUI");
    await view.setup.waitFor(() => view.harness.promptCalls.length === 1);
    const frame = await view.setup.waitForFrame((candidate) => candidate.includes("hello from TUI"));
    assert.deepEqual(view.harness.promptCalls, ["hello from TUI"]);
    assert.equal(view.callbacks.tracked.length, 1);
    assert.equal(view.callbacks.tracked[0], view.tasks.last);
    assert.match(frame, /running/u);
    assert.doesNotMatch(frame, /\bKEA\b/u);

    await typeAndSubmit(view.setup, "must not queue");
    assert.deepEqual(view.harness.promptCalls, ["hello from TUI"]);

    await pressAndFlush(view.setup, () => view.setup.mockInput.pressCtrlC());
    assert.equal(view.callbacks.exits, 1);
  } finally {
    act(() => view.setup.renderer.destroy());
  }
});

test("slash command suggestions follow the composer prefix", async () => {
  const view = await render([]);
  try {
    await act(async () => {
      await view.setup.mockInput.typeText("/");
      await view.setup.flush();
    });
    const allCommands = await view.setup.waitForFrame(
      (candidate) => candidate.includes("create a Session") && candidate.includes("exit Kea"),
    );
    assert.match(allCommands, /\/session/u);
    assert.match(allCommands, /\/model/u);

    await act(async () => {
      await view.setup.mockInput.typeText("m");
      await view.setup.flush();
    });
    const modelOnly = await view.setup.waitForFrame(
      (candidate) => candidate.includes("switch model") && !candidate.includes("create a Session"),
    );
    assert.match(modelOnly, /\/model/u);
    assert.doesNotMatch(modelOnly, /\/session/u);

    await act(async () => {
      await view.setup.mockInput.typeText("issing");
      await view.setup.flush();
    });
    const noMatches = await view.setup.waitForFrame(
      (candidate) => candidate.includes("/missing") && !candidate.includes("switch model"),
    );
    assert.doesNotMatch(noMatches, /create a Session|exit Kea/u);
  } finally {
    act(() => view.setup.renderer.destroy());
  }
});

test("slash command suggestions execute the keyboard selection", async () => {
  const view = await render([]);
  try {
    await act(async () => {
      await view.setup.mockInput.typeText("/");
      await view.setup.flush();
    });
    await pressAndFlush(view.setup, () => view.setup.mockInput.pressArrow("down"));
    await pressAndFlush(view.setup, () => view.setup.mockInput.pressArrow("down"));
    await pressAndFlush(view.setup, () => view.setup.mockInput.pressEnter());

    const providers = await view.setup.waitForFrame(
      (candidate) => candidate.includes("Providers") && candidate.includes("openai"),
    );
    assert.match(providers, /anthropic/u);
    assert.equal(view.calls.newSession, 0);
    assert.deepEqual(view.harness.promptCalls, []);
  } finally {
    act(() => view.setup.renderer.destroy());
  }
});

test("Escape closes slash command suggestions without clearing the composer", async () => {
  const view = await render([]);
  try {
    await act(async () => {
      await view.setup.mockInput.typeText("/");
      await view.setup.flush();
    });
    await view.setup.waitForFrame((candidate) => candidate.includes("create a Session"));
    await pressAndFlush(view.setup, () => view.setup.mockInput.pressEscape());

    const dismissed = await view.setup.waitForFrame(
      (candidate) => candidate.includes("/") && !candidate.includes("create a Session"),
    );
    assert.match(dismissed, /\/\s*$/mu);
  } finally {
    act(() => view.setup.renderer.destroy());
  }
});

test("help, command errors, Escape, and idle exit use the existing command language", async () => {
  const view = await render([]);
  try {
    await typeAndSubmit(view.setup, "/new extra");
    await view.setup.waitForFrame((candidate) => candidate.includes("/new does not accept arguments"));

    await typeAndSubmit(view.setup, "/help");
    const help = await view.setup.waitForFrame(
      (candidate) => candidate.includes("/new") && candidate.includes("/exit"),
    );
    assert.match(help, /\/session/u);
    assert.match(help, /\/model/u);
    await pressAndFlush(view.setup, () => view.setup.mockInput.pressEscape());
    await view.setup.waitForFrame((candidate) => candidate.includes("Ask Kea anything"));

    await typeAndSubmit(view.setup, "/exit");
    await view.setup.waitFor(() => view.callbacks.exits === 1);
  } finally {
    act(() => view.setup.renderer.destroy());
  }
});

test("new, Session, and two-stage model workflows refresh the active snapshot", async () => {
  const fake = fakeRuntime([]);
  fake.addSession({
    id: "session-b",
    title: "Older session",
    cwd: "D:\\older",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
  });
  const view = await render([], {}, fake);
  try {
    await typeAndSubmit(view.setup, "/session");
    await view.setup.waitForFrame((candidate) => candidate.includes("Older session"));
    await pressAndFlush(view.setup, () => view.setup.mockInput.pressArrow("down"));
    await pressAndFlush(view.setup, () => view.setup.mockInput.pressEnter());
    await view.setup.waitFor(() => view.switchSessionCalls.length === 1);
    assert.deepEqual(view.switchSessionCalls, ["session-b"]);
    await view.setup.waitForFrame((candidate) => candidate.includes("D:\\older"));

    await typeAndSubmit(view.setup, "/model");
    await view.setup.waitForFrame((candidate) => candidate.includes("openai"));
    await pressAndFlush(view.setup, () => view.setup.mockInput.pressArrow("down"));
    await pressAndFlush(view.setup, () => view.setup.mockInput.pressEnter());
    await view.setup.waitForFrame((candidate) => candidate.includes("gpt-5"));
    await pressAndFlush(view.setup, () => view.setup.mockInput.pressEnter());
    await view.setup.waitFor(() => view.switchModelCalls.length === 1);
    assert.deepEqual(view.switchModelCalls, [{ provider: "openai", model: "gpt-5" }]);
    await view.setup.waitForFrame(
      (candidate) => candidate.includes("openai/gpt-5") && candidate.includes("Ask Kea anything"),
    );

    await typeAndSubmit(view.setup, "/new");
    await view.setup.waitFor(() => view.calls.newSession === 1);
    await view.setup.waitForFrame((candidate) => candidate.includes("D:\\new"));
  } finally {
    act(() => view.setup.renderer.destroy());
  }
});

test("Coding Agent interaction requests use the bottom panel without owning local selectors", async () => {
  const view = await render([]);
  try {
    assert.ok(view.interaction);
    let selection!: Promise<number | undefined>;
    act(() => {
      selection = view.interaction!.select("Permission", ["Allow once", "Deny"]);
    });
    await view.setup.waitForFrame((candidate) => candidate.includes("Allow once"));
    await pressAndFlush(view.setup, () => view.setup.mockInput.pressArrow("down"));
    await pressAndFlush(view.setup, () => view.setup.mockInput.pressEnter());
    assert.equal(await selection, 1);

    let input!: Promise<string | undefined>;
    act(() => {
      input = view.interaction!.input("Reason", "optional");
    });
    await view.setup.waitForFrame((candidate) => candidate.includes("Reason"));
    await act(async () => {
      await view.setup.mockInput.typeText("  because  ");
      await view.setup.flush();
    });
    await pressAndFlush(view.setup, () => view.setup.mockInput.pressEnter());
    assert.equal(await input, "because");

    let cancelled!: Promise<boolean>;
    act(() => {
      cancelled = view.interaction!.confirm("Confirm", "Continue?");
    });
    await view.setup.waitForFrame((candidate) => candidate.includes("Continue?"));
    await pressAndFlush(view.setup, () => view.setup.mockInput.pressEscape());
    assert.equal(await cancelled, false);
  } finally {
    act(() => view.setup.renderer.destroy());
  }
});

test("an invalid startup model opens mandatory repair and Escape exits", async () => {
  const fake = fakeRuntime([]);
  fake.harness.model = { provider: "missing", model: "removed" };
  const view = await render([], {}, fake);
  try {
    await view.setup.waitForFrame(
      (candidate) => candidate.includes("configured model") && candidate.includes("gpt-5"),
    );
    await act(async () => {
      await Promise.resolve();
      await view.setup.flush();
    });
    await pressAndFlush(view.setup, () => view.setup.mockInput.pressEscape());
    await view.setup.waitFor(() => view.callbacks.exits === 1);
  } finally {
    act(() => view.setup.renderer.destroy());
  }
});

test("renderer teardown unsubscribes, closes pending interaction, and destroys syntax style", async () => {
  const originalDestroy = SyntaxStyle.prototype.destroy;
  let destroyedStyles = 0;
  SyntaxStyle.prototype.destroy = function destroySyntaxStyle(): void {
    destroyedStyles += 1;
    originalDestroy.call(this);
  };
  const view = await render([]);
  try {
    let pending!: Promise<number | undefined>;
    act(() => {
      pending = view.interaction!.select("Permission", ["Allow", "Deny"]);
    });
    await view.setup.waitForFrame((frame) => frame.includes("Permission"));

    act(() => view.setup.renderer.destroy());

    assert.equal(await pending, undefined);
    assert.equal(view.calls.unsubscribe, 1);
    assert.ok(destroyedStyles >= 1);
  } finally {
    SyntaxStyle.prototype.destroy = originalDestroy;
    if (!view.setup.renderer.isDestroyed) act(() => view.setup.renderer.destroy());
  }
});
