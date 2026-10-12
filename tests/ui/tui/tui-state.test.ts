import assert from "node:assert/strict";
import { test } from "bun:test";

import type { AgentMessage, AgentToolCall, AgentToolResult } from "../../../src/core/harness/index.js";
import {
  createTuiState,
  tuiReducer,
  type TuiSessionSnapshot,
  type TuiState,
  type TuiStreamEvent,
} from "../../../src/ui/tui/tui-state.js";

const userMessage: AgentMessage = { role: "user", content: "hello" };
const assistantMessage: AgentMessage = {
  role: "assistant",
  content: [{ type: "text", text: "hi" }],
  model: "sonnet",
  stopReason: "stop",
  latencyMs: 12,
};
const toolMessage: AgentMessage = {
  role: "tool",
  toolCallId: "tool-a",
  name: "read_file",
  content: "contents",
};

function snapshot(overrides: Partial<TuiSessionSnapshot> = {}): TuiSessionSnapshot {
  return {
    id: "session-a",
    title: "Session A",
    model: { provider: "anthropic", model: "sonnet" },
    cwd: "D:\\project",
    history: [userMessage],
    ...overrides,
  };
}

function runningState(): TuiState {
  return tuiReducer(
    tuiReducer(createTuiState(snapshot({ history: [] })), {
      type: "run-started",
      runId: "run-a",
    }),
    {
      type: "turn-started",
      runId: "run-a",
      committed: {
        history: [userMessage],
        title: "Committed title",
        model: { provider: "anthropic", model: "sonnet" },
      },
    },
  );
}

function stream(state: TuiState, event: TuiStreamEvent): TuiState {
  return tuiReducer(state, { type: "stream-event", event });
}

test("creates a Session projection and Session replacement clears transient state", () => {
  let state = createTuiState(snapshot());
  assert.deepEqual(state, {
    session: {
      id: "session-a",
      title: "Session A",
      model: { provider: "anthropic", model: "sonnet" },
      cwd: "D:\\project",
    },
    history: [userMessage],
    composer: "",
    pendingUser: undefined,
    liveTurn: [],
    run: { status: "idle" },
    panel: { kind: "composer" },
    commandMenu: { selectedIndex: 0, dismissed: false },
    notice: undefined,
  });

  state = tuiReducer(state, { type: "composer-changed", value: "draft" });
  state = tuiReducer(state, { type: "prompt-submitted", text: "prompt" });
  state = tuiReducer(state, { type: "notice-changed", message: "old notice" });
  state = tuiReducer(state, {
    type: "session-replaced",
    snapshot: snapshot({
      id: "session-b",
      title: "Session B",
      cwd: undefined,
      history: [assistantMessage],
    }),
  });

  assert.deepEqual(state, createTuiState(snapshot({
    id: "session-b",
    title: "Session B",
    cwd: undefined,
    history: [assistantMessage],
  })));
});

test("reconciles pending user input only on the first Turn snapshot", () => {
  let state = createTuiState(snapshot({ history: [] }));
  state = tuiReducer(state, { type: "composer-changed", value: "draft" });
  state = tuiReducer(state, { type: "prompt-submitted", text: "  original prompt  " });
  assert.equal(state.composer, "");
  assert.equal(state.pendingUser, "  original prompt  ");

  state = tuiReducer(state, { type: "run-started", runId: "run-a" });
  state = tuiReducer(state, {
    type: "turn-started",
    runId: "run-a",
    committed: {
      history: [userMessage],
      title: "Generated title",
      model: { provider: "openai", model: "gpt-5" },
    },
  });
  assert.equal(state.pendingUser, undefined);
  assert.deepEqual(state.history, [userMessage]);
  assert.equal(state.session.title, "Generated title");
  assert.deepEqual(state.session.model, { provider: "openai", model: "gpt-5" });
  assert.deepEqual(state.run, { status: "running", runId: "run-a", sawTurnStart: true });

  state = tuiReducer(state, {
    type: "turn-started",
    runId: "run-a",
    committed: {
      history: [assistantMessage],
      title: "must be ignored",
      model: { provider: "google", model: "gemini" },
    },
  });
  assert.deepEqual(state.history, [userMessage]);
  assert.equal(state.session.title, "Generated title");
});

test("keeps interleaved text and thinking blocks in event order", () => {
  let state = runningState();
  state = stream(state, { type: "text-delta", runId: "run-a", text: "first" });
  state = stream(state, { type: "thinking-start", runId: "run-a" });
  state = stream(state, { type: "thinking-delta", runId: "run-a", thinking: "reason" });
  state = stream(state, { type: "text-start", runId: "run-a" });
  state = stream(state, { type: "text-delta", runId: "run-a", text: "second" });
  state = stream(state, { type: "text-end", runId: "run-a" });

  assert.deepEqual(state.liveTurn, [
    { kind: "text", text: "first" },
    { kind: "thinking", thinking: "reason" },
    { kind: "text", text: "second" },
  ]);

  const unchanged = stream(state, { type: "text-delta", runId: "other", text: "ignored" });
  assert.equal(unchanged, state);
});

test("tracks Tool facts by run and call ID, including deltas without starts", () => {
  const callA: AgentToolCall = {
    type: "toolCall",
    id: "tool-a",
    name: "read_file",
    arguments: { path: "README.md" },
  };
  const callB: AgentToolCall = {
    type: "toolCall",
    id: "tool-b",
    name: "bash",
    arguments: { command: "pwd" },
  };
  const resultA: AgentToolResult = { content: "contents", isError: false };
  const resultB: AgentToolResult = { content: "D:\\project", isError: false };

  let state = runningState();
  state = stream(state, {
    type: "tool-call-delta",
    runId: "run-a",
    id: "tool-a",
    argumentsDelta: '{"path":',
  });
  state = stream(state, {
    type: "tool-call-start",
    runId: "run-a",
    id: "tool-b",
    name: "bash",
  });
  state = stream(state, {
    type: "tool-call-delta",
    runId: "run-a",
    id: "tool-b",
    argumentsDelta: '{"command":"pwd"}',
  });
  state = stream(state, { type: "tool-call", runId: "run-a", cwd: "D:\\project", call: callA });
  state = stream(state, {
    type: "tool-result",
    runId: "run-a",
    cwd: "D:\\project",
    call: callB,
    result: resultB,
  });
  state = stream(state, {
    type: "tool-result",
    runId: "run-a",
    cwd: "D:\\project",
    call: callA,
    result: resultA,
  });

  assert.equal(state.liveTurn.length, 2);
  assert.deepEqual(state.liveTurn[0], {
    kind: "tool",
    runId: "run-a",
    id: "tool-a",
    name: "read_file",
    argumentsText: '{"path":',
    call: callA,
    result: resultA,
  });
  assert.deepEqual(state.liveTurn[1], {
    kind: "tool",
    runId: "run-a",
    id: "tool-b",
    name: "bash",
    argumentsText: '{"command":"pwd"}',
    call: callB,
    result: resultB,
  });
});

test("Turn completion uses final messages and ignores mismatched Run IDs", () => {
  let state = stream(runningState(), {
    type: "text-delta",
    runId: "run-a",
    text: "draft",
  });
  const mismatched = tuiReducer(state, {
    type: "turn-ended",
    runId: "other",
    message: assistantMessage,
    toolResults: [toolMessage],
  });
  assert.equal(mismatched, state);

  state = tuiReducer(state, {
    type: "turn-ended",
    runId: "run-a",
    message: assistantMessage,
    toolResults: [toolMessage],
  });
  assert.deepEqual(state.history, [userMessage, assistantMessage, toolMessage]);
  assert.deepEqual(state.liveTurn, []);
});

test("Run completion reconciles before the first Turn and never after it", () => {
  const committed = {
    history: [userMessage, assistantMessage],
    title: "Committed after early failure",
    model: { provider: "openai", model: "gpt-5" },
  } as const;
  let state = createTuiState(snapshot({ history: [] }));
  state = tuiReducer(state, { type: "prompt-submitted", text: "hello" });
  state = tuiReducer(state, { type: "run-started", runId: "run-a" });
  assert.equal(tuiReducer(state, {
    type: "run-ended",
    runId: "other",
    reason: "completed",
    errorMessage: undefined,
    committed,
  }), state);

  state = tuiReducer(state, {
    type: "run-ended",
    runId: "run-a",
    reason: "error",
    errorMessage: "safe redacted error",
    committed,
  });
  assert.deepEqual(state.run, {
    status: "error",
    runId: "run-a",
    message: "safe redacted error",
  });
  assert.deepEqual(state.history, committed.history);
  assert.equal(state.session.title, committed.title);
  assert.equal(state.pendingUser, undefined);
  assert.deepEqual(state.liveTurn, []);

  let afterTurn = runningState();
  afterTurn = tuiReducer(afterTurn, {
    type: "run-ended",
    runId: "run-a",
    reason: "aborted",
    errorMessage: undefined,
    committed: {
      history: [assistantMessage],
      title: "ignored",
      model: { provider: "google", model: "ignored" },
    },
  });
  assert.deepEqual(afterTurn.run, { status: "aborted", runId: "run-a" });
  assert.deepEqual(afterTurn.history, [userMessage]);
  assert.equal(afterTurn.session.title, "Committed title");
});

test("panel state contains only display data and returns to the composer", () => {
  let state = createTuiState(snapshot());
  state = tuiReducer(state, {
    type: "panel-opened",
    panel: { kind: "providers", providers: ["anthropic", "openai"], selectedIndex: 0 },
  });
  state = tuiReducer(state, { type: "panel-moved", delta: 8 });
  assert.deepEqual(state.panel, {
    kind: "providers",
    providers: ["anthropic", "openai"],
    selectedIndex: 1,
  });

  state = tuiReducer(state, {
    type: "interaction-changed",
    request: { kind: "input", title: "Reason", placeholder: "optional" },
  });
  state = tuiReducer(state, { type: "panel-input-changed", value: "because" });
  assert.deepEqual(state.panel, {
    kind: "interaction",
    request: { kind: "input", title: "Reason", placeholder: "optional" },
    selectedIndex: 0,
    input: "because",
  });
  state = tuiReducer(state, { type: "interaction-changed", request: undefined });
  assert.deepEqual(state.panel, { kind: "composer" });
});
