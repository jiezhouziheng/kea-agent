# CLI/TUI Bracketed Functions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the public `CliUi` lifecycle object with a public `runCli()` bracketed function so both concrete UIs create, bind, run, and clean up their own Interaction and terminal resources.

**Architecture:** `runCli(runtime, options)` owns one complete readline UI lifetime through local variables and closures; `runTui(runtime, options)` retains its existing bracketed OpenTUI/React lifetime. `main` selects one concrete function and remains the sole owner of `ApplicationRuntime.close()`, with no common UI interface, factory, handle, registry, manager, or controller.

**Tech Stack:** TypeScript 7, Bun 1.3.7, `bun:test`, Node readline promises, OpenTUI React (unchanged TUI path).

**Spec:** `docs/superpowers/specs/2026-08-25-bracketed-ui-functions-design.md`

## Global Constraints

- Preserve all uncommitted slash-command and TUI component changes already present in the working tree.
- Do not add `ApplicationUi`, a UI context/controller, a lifecycle handle, a registry, or a common UI factory.
- `runCli()` and `runTui()` bind their own concrete Interaction; neither function closes `ApplicationRuntime`.
- `main` closes `ApplicationRuntime` exactly once in its existing outer `finally`.
- Keep the TUI branch dynamically imported so `--ui cli` does not load OpenTUI native dependencies.
- Preserve existing Prompt, Session, model, permission, error, EOF, SIGINT, and redaction behavior.
- Use local closures in `runCli()`; do not replace `CliUi` with a context object that merely recreates `this`.
- Do not run `verify:dist`, `verify:global`, unrelated repository-wide jobs, or create a commit unless the user explicitly requests them.

## Target File Structure

```text
src/ui/cli/
├── run-cli.ts             # public bracketed CLI lifetime and existing workflows
├── cli-interactions.ts    # unchanged UserInteraction adapter
├── renderer.ts            # unchanged linear terminal renderer
└── index.ts               # runCli/RunCliOptions plus existing low-level exports

src/ui/tui/
└── run-tui.tsx            # existing bracketed TUI lifetime, unchanged public API

tests/ui/cli/
├── run-cli.test.ts        # renamed and migrated CliUi behavior/lifecycle tests
└── full-composition.test.ts
```

---

### Task 1: Define and implement the bracketed `runCli()` lifecycle

**Files:**
- Create: `src/ui/cli/run-cli.ts`
- Move: `tests/ui/cli/cli-ui.test.ts` → `tests/ui/cli/run-cli.test.ts`
- Test: `tests/ui/cli/run-cli.test.ts`

**Interfaces:**
- Consumes: `ApplicationRuntime`, `AgentHarness`, `CliInteractions`, `Renderer`, `parseInput`, Node readline `Interface`.
- Produces: `runCli(runtime: ApplicationRuntime, options: RunCliOptions): Promise<void>` and `RunCliOptions`.

- [ ] **Step 1: Rename the test file without changing its existing assertions**

Run:

```powershell
git mv tests/ui/cli/cli-ui.test.ts tests/ui/cli/run-cli.test.ts
```

The move keeps history intact. Do not stage or commit it.

- [ ] **Step 2: Extend the test Project so it can observe internal Interaction binding**

In `tests/ui/cli/run-cli.test.ts`, import `UserInteraction`, add an optional callback, and delegate the fake Project method to it:

```ts
import {
  ApplicationRuntime,
  type Project,
  type UserInteraction,
} from "../../../src/coding-agent/index.js";

function makeProject(options: {
  readonly models?: readonly ModelConfig[];
  readonly listSessions?: () => Promise<readonly SessionMetadata[]>;
  readonly createHarness?: () => Promise<AgentHarness>;
  readonly createHarnessFromSession?: (sessionId: string) => Promise<AgentHarness>;
  readonly bindUserInteraction?: (interaction: UserInteraction) => void;
} = {}): Project {
  // Preserve the existing model and Harness setup.
  return {
    // Preserve the existing Project methods.
    bindUserInteraction: options.bindUserInteraction ?? (() => {}),
  } as unknown as Project;
}
```

Keep every existing fake Project method from the current helper; only replace its no-op `bindUserInteraction` property.

- [ ] **Step 3: Write the failing lifecycle tests**

Import the desired entry before it exists:

```ts
import { runCli } from "../../../src/ui/cli/run-cli.js";
```

Add a test that exercises the real CLI loop, Interaction, subscription, SIGINT registration, and cleanup:

```ts
test("runCli binds its Interaction and cleans terminal resources before returning", async () => {
  const answers = ["hello", "1", "/exit"];
  const calls: string[] = [];
  let closeCalls = 0;
  let bound: UserInteraction | undefined;
  const readline = {
    question: async (prompt: string): Promise<string> => {
      calls.push(prompt.includes("Selection?") ? "question:permission" : `question:${prompt}`);
      return answers.shift() ?? "/exit";
    },
    close: () => { closeCalls += 1; },
  } as unknown as Interface;
  const harness = makeHarness("1");
  harness.prompt = async () => {
    assert.ok(bound, "runCli must bind before prompting");
    const answer = await bound.select("needs approval", ["Allow", "Deny"]);
    assert.equal(answer, 0);
  };
  const project = makeProject({
    createHarness: async () => asHarness(harness),
    bindUserInteraction: (interaction) => { bound = interaction; },
  });
  const runtime = new ApplicationRuntime(project, asHarness(harness));
  const sigintListeners = process.listenerCount("SIGINT");

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
  assert.deepEqual(calls, ["question:kea> ", "question:permission", "question:kea> "]);
  assert.equal(closeCalls, 1);
  assert.equal(harness.subscribeCalls, 1);
  assert.equal(harness.unsubscribeCalls, 1);
  assert.equal(process.listenerCount("SIGINT"), sigintListeners);
});
```

Add the exceptional cleanup case before implementing the function:

```ts
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
```

- [ ] **Step 4: Run the new test and verify RED**

Run:

```powershell
bun test tests/ui/cli/run-cli.test.ts --test-name-pattern "binds its Interaction"
bun test tests/ui/cli/run-cli.test.ts --test-name-pattern "cleans terminal resources"
```

Expected: both commands FAIL because `src/ui/cli/run-cli.ts` or its `runCli` export does not exist. A syntax or fixture error is not the expected failure and must be corrected before production code is added.

- [ ] **Step 5: Implement `RunCliOptions` and the bracketed function**

Create `src/ui/cli/run-cli.ts`. Port the current `CliUi` logic into one exported function with local closures. The required outer shape is:

```ts
import { createInterface, type Interface } from "node:readline/promises";

import type { AgentHarness } from "../../core/harness/index.js";
import { ApplicationRuntime } from "../../coding-agent/index.js";
import { parseInput } from "../commands.js";
import { CliInteractions } from "./cli-interactions.js";
import { Renderer } from "./renderer.js";

export interface RunCliOptions {
  readonly thinking: "hidden" | "visible";
  readonly toolDetails: "compact" | "full";
  readonly color?: boolean;
  readonly reportError: (error: unknown) => void;
  readonly readline?: Interface;
  readonly input?: NodeJS.ReadStream;
  readonly write?: (text: string) => void;
  readonly log?: (text: string) => void;
}

const PROMPT = "kea> ";
const MODEL_REQUIRED = "current model is not configured; use /model before prompting";

export async function runCli(
  runtime: ApplicationRuntime,
  options: RunCliOptions,
): Promise<void> {
  const readline = options.readline ?? createInterface({
    input: options.input ?? process.stdin,
    output: process.stdout,
  });
  let unsubscribe = (): void => {};
  const onSigint = (): void => {
    if (runtime.current.isRunning) runtime.current.abort();
  };

  try {
  const renderer = new Renderer({
    thinking: options.thinking,
    toolDetails: options.toolDetails,
    ...(options.color === undefined ? {} : { color: options.color }),
    write: options.write ?? ((text) => process.stdout.write(text)),
    log: options.log ?? ((text) => console.log(text)),
  });
  const interactions = new CliInteractions({
    question: (prompt, questionOptions) => questionOptions === undefined
      ? readline.question(prompt)
      : readline.question(prompt, questionOptions),
    log: options.log ?? ((text) => console.log(text)),
  });

  const readPrompt = async (prompt = PROMPT): Promise<string | undefined> => {
    try {
      return await readline.question(prompt);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return undefined;
      throw error;
    }
  };

  const chooseIndex = async (
    prompt: string,
    count: number,
  ): Promise<number | undefined> => {
    const answer = await readPrompt(prompt);
    if (answer === undefined) return undefined;
    const trimmed = answer.trim();
    if (!/^\d+$/u.test(trimmed)) return undefined;
    const index = Number.parseInt(trimmed, 10);
    return index >= 1 && index <= count ? index : undefined;
  };

  const ensureConfiguredModel = async (candidate: AgentHarness): Promise<boolean> => {
    const project = runtime.project;
    if (await project.isConfiguredModel(candidate.model)) return true;
    const models = await project.modelOptions();
    renderer.renderError(
      `model ${candidate.model.provider}/${candidate.model.model} is not configured`,
    );
    renderer.renderSelection(
      "Choose a configured model:",
      models.map((model) => `${model.provider}/${model.model}`),
    );
    const index = await chooseIndex("Model number? ", models.length);
    if (index === undefined) return false;
    try {
      await project.switchModel(candidate, models[index - 1]!);
      return true;
    } catch (error) {
      options.reportError(error);
      return false;
    }
  };

  const repairModelAndRender = async (harness: AgentHarness): Promise<void> => {
    const configured = await ensureConfiguredModel(harness);
    renderer.renderSession(harness);
    if (!configured) renderer.renderError(MODEL_REQUIRED);
  };

  const chooseAndSwitchSession = async (): Promise<void> => {
    const sessions = await runtime.project.listSessions();
    if (sessions.length === 0) {
      renderer.renderError("no sessions yet");
      return;
    }
    renderer.renderSelection(
      "Sessions (newest first):",
      sessions.map((metadata) => `${metadata.title} — ${metadata.updatedAt}`),
    );
    const index = await chooseIndex("Session number? ", sessions.length);
    if (index === undefined) return;
    await repairModelAndRender(await runtime.switchSession(sessions[index - 1]!.id));
  };

  const chooseAndSwitchModel = async (): Promise<void> => {
    const models = await runtime.project.modelOptions();
    const providers = [...new Set(models.map((model) => model.provider))];
    renderer.renderSelection("Providers:", providers);
    const providerIndex = await chooseIndex("Provider number? ", providers.length);
    if (providerIndex === undefined) return;
    const provider = providers[providerIndex - 1]!;
    const providerModels = models.filter((model) => model.provider === provider);
    renderer.renderSelection(
      `Models for ${provider}:`,
      providerModels.map((model) => model.model),
    );
    const modelIndex = await chooseIndex("Model number? ", providerModels.length);
    if (modelIndex === undefined) return;
    await runtime.project.switchModel(runtime.current, providerModels[modelIndex - 1]!);
  };

  runtime.bindUserInteraction(interactions);
  process.on("SIGINT", onSigint);
    if (!await ensureConfiguredModel(runtime.current)) return;
    unsubscribe = runtime.subscribe((event) => renderer.handle(event));
    renderer.renderSession(runtime.current);
    while (true) {
      const input = await readPrompt();
      if (input === undefined) return;
      const action = parseInput(input);
      switch (action.kind) {
        case "prompt":
          if (action.text.trim() === "") break;
          if (!await runtime.project.isConfiguredModel(runtime.current.model)) {
            renderer.renderError(MODEL_REQUIRED);
            break;
          }
          try {
            await runtime.current.prompt(action.text);
          } catch (error) {
            options.reportError(error);
          }
          break;
        case "new-session":
          try {
            await repairModelAndRender(await runtime.newSession());
          } catch (error) {
            options.reportError(error);
          }
          break;
        case "switch-session":
          try {
            await chooseAndSwitchSession();
          } catch (error) {
            options.reportError(error);
          }
          break;
        case "switch-model":
          try {
            await chooseAndSwitchModel();
          } catch (error) {
            options.reportError(error);
          }
          break;
        case "help":
          renderer.renderHelp();
          break;
        case "exit":
          return;
        case "command-error":
          renderer.renderError(action.message);
          break;
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    try {
      unsubscribe();
    } finally {
      readline.close();
    }
  }
}
```

- [ ] **Step 6: Run the lifecycle tests and verify GREEN**

Run:

```powershell
bun test tests/ui/cli/run-cli.test.ts --test-name-pattern "binds its Interaction"
bun test tests/ui/cli/run-cli.test.ts --test-name-pattern "cleans terminal resources"
bun test tests/ui/cli/run-cli.test.ts
```

Expected: both selected tests pass and the full file exits `0`. The remaining class-based tests still use `CliUi` until Task 2 and must be migrated before deleting it.

- [ ] **Step 7: Review the Task 1 diff without committing**

Run:

```powershell
git diff -- src/ui/cli/run-cli.ts tests/ui/cli/run-cli.test.ts
git status --short
```

Confirm only the new function, test move, and test fixture/lifecycle assertions were added in this task.

---

### Task 2: Migrate CLI consumers and remove `CliUi`

**Files:**
- Delete: `src/ui/cli/cli-ui.ts`
- Modify: `src/ui/cli/index.ts`
- Modify: `src/main.ts`
- Modify: `tests/ui/cli/run-cli.test.ts`
- Modify: `tests/ui/cli/full-composition.test.ts`
- Modify: `tests/import-smoke.test.ts`
- Test: `tests/main.test.ts`

**Interfaces:**
- Consumes: `runCli()` and `RunCliOptions` from Task 1.
- Produces: CLI barrel export and production composition using only the bracketed function.

- [ ] **Step 1: Migrate the existing CLI behavior helper and tests**

Replace the test import and helper:

```ts
import { runCli, type RunCliOptions } from "../../../src/ui/cli/run-cli.js";

function runUi(
  runtime: ApplicationRuntime,
  options: {
    readonly readline: Interface;
    readonly calls: string[];
    readonly write?: (text: string) => void;
  },
): Promise<void> {
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
```

For every ordinary test, replace:

```ts
const ui = makeUi(runtime, uiOptions);
await ui.run();
ui.close();
```

with:

```ts
await runUi(runtime, uiOptions);
```

For the permission test, capture `UserInteraction` through `makeProject({ bindUserInteraction })` and call the captured port from `harness.prompt`; do not expose an Interaction from `runCli()`.

For the SIGINT test, store `const runPromise = runUi(runtime, uiOptions)`, emit SIGINT after the Prompt starts, release the gate, and await the same Promise in `finally`. Remove every `ui.close()` call.

Replace the old `close is idempotent` test with the two lifecycle tests from Task 1; the function has no public `close()` operation to test.

Move assertions that previously ran before `ui.close()` to after `runCli()` returns. Because the
function has already cleaned up at that point, update the three active-subscription expectations:

```ts
assert.equal(created.unsubscribeCalls, 1);
assert.equal(restored.unsubscribeCalls, 1);
assert.equal(initial.unsubscribeCalls, 1); // failed Session activation keeps this Harness active
```

Do not change the corresponding `subscribeCalls`, Session activation, Prompt routing, or rendered
output assertions.

- [ ] **Step 2: Run all migrated CLI unit tests**

Run:

```powershell
bun test tests/ui/cli/run-cli.test.ts
```

Expected: all migrated CLI tests pass with `0 fail`. A failure in Session/model/permission behavior means the closure port changed behavior and must be corrected before deleting the class.

- [ ] **Step 3: Migrate the full composition test**

Replace `CliUi` construction, explicit binding, and manual close with:

```ts
import { runCli } from "../../../src/ui/cli/index.js";

await runCli(runtime, {
  thinking: "hidden",
  toolDetails: "compact",
  color: false,
  readline,
  write: (text) => chunks.push(text),
  log: () => {},
  reportError: (error) => chunks.push(`ERROR: ${String(error)}`),
});
runtime.close();
```

Keep the existing real Project/Harness/model stream and output assertions unchanged.

- [ ] **Step 4: Update the CLI barrel and import smoke test**

Change `src/ui/cli/index.ts` to:

```ts
export { CliInteractions } from "./cli-interactions.js";
export { Renderer } from "./renderer.js";
export { runCli } from "./run-cli.js";
export type { RunCliOptions } from "./run-cli.js";
```

Change `tests/import-smoke.test.ts` from `CliUi` to `runCli`:

```ts
import { runCli } from "../src/ui/cli/index.js";

void [
  // existing values
  runCli,
];
```

Run the import smoke test:

```powershell
bun test tests/import-smoke.test.ts
```

Expected: import smoke passes using the new public export.

- [ ] **Step 5: Delete the obsolete class and observe the remaining production consumer fail**

Delete `src/ui/cli/cli-ui.ts` with `apply_patch`, then run:

```powershell
bun run typecheck
```

Expected: FAIL specifically because `src/main.ts` still imports or constructs `CliUi`. Correct any other failure before continuing; this RED result proves the production composition root still needs migration.

- [ ] **Step 6: Update `main` to call `runCli()`**

Replace the import and CLI branch in `src/main.ts`:

```ts
import { runCli } from "./ui/cli/index.js";

// ...

if (args.ui === "cli") {
  await runCli(applicationRuntime, {
    thinking: config.thinking,
    toolDetails: config.toolDetails,
    reportError,
  });
} else {
  const { runTui } = await import("./ui/tui/run-tui.js");
  await runTui(applicationRuntime, {
    thinking: config.thinking,
    toolDetails: config.toolDetails,
    redact: (message) => config.redact(message),
  });
}
```

Do not change the surrounding catch/redaction block or the outer `applicationRuntime.close()` finally.

- [ ] **Step 7: Verify no obsolete lifecycle symbols remain**

Search all production and test consumers:

```powershell
rg -n "\bCliUi\b|CliUiOptions|cli-ui\.js" src tests scripts --glob '!dist/**'
```

Expected: no matches.

- [ ] **Step 8: Run the migrated consumers**

Run:

```powershell
bun test tests/ui/cli/run-cli.test.ts tests/ui/cli/full-composition.test.ts tests/import-smoke.test.ts tests/main.test.ts
bun run typecheck
```

Expected: all selected tests pass and typecheck exits `0`.

- [ ] **Step 9: Review the Task 2 diff without committing**

Run:

```powershell
git diff -- src/ui/cli src/main.ts tests/ui/cli tests/import-smoke.test.ts tests/main.test.ts
git status --short
```

Confirm `runCli` is the only production CLI lifecycle entry and current unrelated TUI changes remain intact.

---

### Task 3: Supersede ADR-0004 and align current architecture

**Files:**
- Create: `docs/adr/0005-use-bracketed-functions-for-concrete-ui-lifecycles.md`
- Modify: `docs/adr/0004-adopt-opentui-react-as-the-default-ui.md`
- Modify: `docs/adr/README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/superpowers/specs/2026-08-25-bracketed-ui-functions-design.md`

**Interfaces:**
- Consumes: final `runCli()`/`runTui()` production shape from Task 2.
- Produces: authoritative ADR and architecture text that match the implemented code.

- [ ] **Step 1: Write ADR-0005**

Create the ADR with this decision structure:

```markdown
---
status: accepted
date: 2026-08-25
implementation: complete
supersedes: ADR-0004
---

# Use bracketed functions for concrete UI lifecycles

## Context

ADR-0004 selected `runTui()` but retained the readline UI as `CliUi`. Both UIs are single-run
operations, neither supports process-local UI switching, and no consumer needs a public lifecycle
object. The concrete UI owns the knowledge required to construct and bind its UserInteraction.

## Decision

- The public concrete entries are `runCli(runtime, options): Promise<void>` and
  `runTui(runtime, options): Promise<void>`.
- Each function creates and binds its concrete UserInteraction and cleans up every UI resource it
  creates before returning.
- Neither function closes ApplicationRuntime; main retains that outer ownership.
- CLI remains statically imported and TUI remains dynamically imported.
- Kea does not add ApplicationUi, a lifecycle handle, UI factory, registry, manager, or controller.
- ADR-0004's default TUI, permanent CLI, OpenTUI React, delivery, data projection, and failure
  decisions remain in force through this superseding ADR.

## Rejected alternatives

### Keep CliUi

It exposes construction, binding, run, and close as caller choreography even though Kea has only
one legal CLI lifetime.

### Return a lifecycle handle

`createCli()` returning interactions/run/close preserves the same control surface without adding a
consumer that needs it.

### Bind in main

It makes the composition root know how each concrete UI constructs its reverse interaction port.

### Add ApplicationUi

Two statically selected local UIs still do not require polymorphism, registration, or external
lifecycle control.

## Consequences

- main selects functions and no longer binds or closes a concrete UI.
- UI functions depend on ApplicationRuntime.bindUserInteraction but core and coding-agent remain
  independent of concrete UI modules.
- Tests drive each complete UI operation and observe Interaction binding through the Project port.
```

Retain ADR formatting conventions used in `docs/adr/0004-adopt-opentui-react-as-the-default-ui.md`.

- [ ] **Step 2: Mark ADR-0004 superseded without rewriting its history**

Change only its front matter and add a one-line note after the title:

```yaml
status: superseded by ADR-0005
```

```markdown
ADR-0005 supersedes this decision while retaining its product mode, OpenTUI, delivery, and data
projection choices; it changes the concrete UI lifecycle boundary.
```

Do not edit ADR-0004's original considered options or rationale.

- [ ] **Step 3: Update the ADR index**

Change ADR-0004's status to `superseded by ADR-0005` and add:

```markdown
| [0005](0005-use-bracketed-functions-for-concrete-ui-lifecycles.md) | accepted | Concrete CLI and TUI each own one bracketed function lifetime |
```

- [ ] **Step 4: Update `docs/architecture.md`**

Make these exact semantic changes:

```ts
async function runCli(
  runtime: ApplicationRuntime,
  options: RunCliOptions,
): Promise<void>;
```

- Replace every current `CliUi` lifecycle description with `runCli()` creating readline,
  `Renderer`, and `CliInteractions`, binding internally, and cleaning them in `finally`.
- Keep the statement that CLI is a linear one-Prompt-at-a-time loop.
- State that both concrete UI functions bind their own Interaction and main only selects one.
- Change the public entry from `CliUi` to `runCli`/`RunCliOptions`; keep `CliInteractions` and
  `Renderer` listed.
- Keep the TUI dynamic-import and ApplicationRuntime ownership text unchanged.

- [ ] **Step 5: Mark the approved design implemented**

Change the design status to:

```markdown
设计已实施。
```

- [ ] **Step 6: Check authority alignment**

Run:

```powershell
rg -n "\bCliUi\b|CliUiOptions|constructs.*CLI|绑定其 interactions|implementation: pending" docs/architecture.md docs/adr docs/superpowers/specs/2026-08-25-bracketed-ui-functions-design.md
```

Expected: `CliUi` appears only in historical explanation inside ADR-0004/ADR-0005 or the design's background/migration discussion; current architecture and accepted ADR index describe `runCli()`.

- [ ] **Step 7: Review the documentation diff without committing**

Run:

```powershell
git diff -- docs/adr docs/architecture.md docs/superpowers/specs/2026-08-25-bracketed-ui-functions-design.md
git diff --check
```

Expected: no whitespace errors and no unrelated historical documentation rewrite.

---

### Task 4: Relevant final verification

**Files:**
- Verify only; no planned production edits.

**Interfaces:**
- Consumes: all code, tests, and documentation from Tasks 1-3.
- Produces: fresh evidence that the changed UI boundary works and ships through TypeScript build.

- [ ] **Step 1: Verify stale lifecycle symbols are gone**

Run:

```powershell
rg -n "\bCliUi\b|CliUiOptions|new CliUi|cli-ui\.js" src tests scripts --glob '!dist/**'
```

Expected: no matches.

- [ ] **Step 2: Run all UI, import, and main tests**

Run:

```powershell
bun test tests/ui tests/import-smoke.test.ts tests/main.test.ts
```

Expected: all selected tests pass with `0 fail`. This includes the existing TUI tests and the uncommitted slash-command/component work already in the tree.

- [ ] **Step 3: Run TypeScript verification**

Run:

```powershell
bun run typecheck
bun run build
```

Expected: both commands exit `0`; the build emits `dist/src/ui/cli/run-cli.js` and no longer emits `dist/src/ui/cli/cli-ui.js` after the clean build.

- [ ] **Step 4: Inspect the clean-build CLI artifacts**

Run:

```powershell
Get-ChildItem -LiteralPath 'dist/src/ui/cli' | Select-Object -ExpandProperty Name
```

Expected: `run-cli.js` and `run-cli.d.ts` exist; `cli-ui.js` and `cli-ui.d.ts` do not exist.

- [ ] **Step 5: Run final diff checks**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: no diff errors. The status includes the pre-existing slash-command/TUI component changes plus this function-boundary implementation and documentation; no unrelated files appear.

- [ ] **Step 6: Report without committing**

Report:

- `runCli()` internal Interaction binding and cleanup behavior;
- removal of `CliUi`/`CliUiOptions`;
- selected test pass/fail counts, typecheck, and build results;
- ADR-0005 and architecture alignment;
- explicit confirmation that `verify:dist`, `verify:global`, and commit were not performed.
