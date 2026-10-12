import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";

import {
  AgentHarness,
  AgentTool,
  AgentToolRegistry,
  runAgentLoop,
  Session,
  SessionRepository,
} from "../src/core/harness/index.js";

import {
  createApplicationRuntime,
  ProjectError,
} from "../src/coding-agent/index.js";

import { runCli } from "../src/ui/cli/index.js";

import type {
  AgentRunIdentity,
  AgentToolCall,
  AgentToolResult,
  HarnessConfig,
  HarnessEvent,
  HarnessEventBus,
  HarnessHooks,
  SessionMetadata,
  SessionNode,
} from "../src/core/harness/index.js";

import type {
  InteractionOptions,
  Project,
  ProjectInfo,
  UserInteraction,
} from "../src/coding-agent/index.js";

import type {
  ModelRuntime,
  ProtocolId,
  RuntimeProviderConfig,
  StreamChunk,
} from "../src/core/ai/index.js";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const INDEX_URL = new URL("../src/index.ts", import.meta.url);
const MAIN_URL = new URL("../src/main.ts", import.meta.url);
const TUI_URL = new URL("../src/ui/tui/run-tui.tsx", import.meta.url);

function importExpression(url: URL): string {
  return [
    'if (!process.versions.bun) throw new Error("child is not running under Bun");',
    `await import(${JSON.stringify(url.href)});`,
  ].join("\n");
}

void [
  runAgentLoop,
  AgentTool,
  AgentToolRegistry,
  AgentHarness,
  Session,
  SessionRepository,
  createApplicationRuntime,
  ProjectError,
  runCli,
];

// Type-only assertions — keep imports from being tree-shaken
type PublicAgentTypes = [
  AgentRunIdentity,
  AgentToolCall,
  AgentToolResult,
];

type PublicHarnessTypes = [
  HarnessConfig,
  HarnessEvent,
  SessionMetadata,
  SessionNode,
];

type PublicCodingAgentTypes = [
  Project,
  ProjectInfo,
  UserInteraction,
  InteractionOptions,
];

type PublicEventTypes = [HarnessEventBus, HarnessEvent, HarnessHooks];
type PublicAiTypes = [ModelRuntime, ProtocolId, RuntimeProviderConfig, StreamChunk];

void (null as PublicAgentTypes | null);
void (null as PublicHarnessTypes | null);
void (null as PublicCodingAgentTypes | null);
void (null as PublicEventTypes | null);
void (null as PublicAiTypes | null);

test("public core imports without credentials or side effects", () => {
  const environment = { ...process.env };
  delete environment.ANTHROPIC_API_KEY;
  delete environment.OPENAI_API_KEY;
  delete environment.GEMINI_API_KEY;

  const child = spawnSync(
    process.execPath,
    ["--eval", importExpression(INDEX_URL)],
    {
      cwd: PROJECT_ROOT,
      env: environment,
      encoding: "utf8",
    },
  );

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "");
  assert.equal(child.stderr, "");
});

test("production main import is silent and side-effect free", () => {
  const child = spawnSync(
    process.execPath,
    ["--eval", importExpression(MAIN_URL)],
    { cwd: PROJECT_ROOT, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "");
  assert.equal(child.stderr, "");
});

test("TUI entry import is silent and does not install signal listeners", () => {
  const expression = [
    'const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"];',
    "const before = Object.fromEntries(signals.map((signal) => [signal, process.listenerCount(signal)]));",
    `await import(${JSON.stringify(TUI_URL.href)});`,
    "const after = Object.fromEntries(signals.map((signal) => [signal, process.listenerCount(signal)]));",
    'if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error("TUI import changed signal listeners");',
  ].join("\n");
  const child = spawnSync(process.execPath, ["--eval", expression], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    timeout: 5_000,
  });

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "");
  assert.equal(child.stderr, "");
});

test("production main does not load dotenv or read credential environment variables", () => {
  const source = readFileSync(MAIN_URL, "utf8");
  assert.ok(!source.includes("dotenv"), "main.ts must not load dotenv");
  assert.ok(!source.includes("process.env"), "main.ts must not read process.env");
  for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) {
    assert.ok(!source.includes(name), `main.ts must not read ${name}`);
  }
});
