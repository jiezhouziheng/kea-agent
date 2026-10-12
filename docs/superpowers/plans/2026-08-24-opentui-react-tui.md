# OpenTUI React TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen OpenTUI React interface that reaches feature parity with Kea's current readline CLI, becomes the default only after the parity gate, and permanently retains `--ui cli`.

**Architecture:** Keep `ApplicationRuntime`, `Project`, `AgentHarness`, `HarnessEvent`, and `UserInteraction` unchanged. The TUI is one bracketed `runTui(runtime, options)` operation; `TuiApp` projects current Harness facts into a pure local reducer and owns command workflows, while `TuiInteractions` implements the existing reverse interaction port. `main.ts` selects concrete UIs directly and dynamically imports only the TUI branch.

**Tech Stack:** Bun 1.3.7, TypeScript 7.0.2 with NodeNext and `tsc -> dist`, `@opentui/core` 0.5.8, `@opentui/react` 0.5.8, React 19.2.8, `@types/react` 19.2.18, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-08-24-opentui-tui-design.md`

## Global Constraints

- Keep Bun 1.3.7 and `tsc -> dist`; do not add bundling, React DOM, Node/npm fallbacks, or a second package/lockfile.
- Pin `@opentui/core` and `@opentui/react` to `0.5.8`, `react` to `19.2.8`, and `@types/react` to `19.2.18`.
- Do not directly declare or use `react-devtools-core` or `ws`; Bun may retain them transitively because the published OpenTUI React package omits optional-peer metadata.
- Keep `HarnessEvent` and `UserInteraction` unchanged; do not introduce cumulative message events or a second event bus.
- Do not add `ApplicationUi`, `TuiUi`, `runCli`, a UI factory, registry, manager, controller, global store, Context provider, or runtime UI switching.
- The production TUI consists of exactly `run-tui.tsx`, `tui-app.tsx`, `tui-state.ts`, and `tui-interactions.ts`; keep small display components inside `tui-app.tsx` initially.
- `--ui cli` remains permanent. During parity work omitted `--ui` temporarily stays CLI; switch the default to TUI only in Task 9.
- TUI selection on non-interactive stdin or stdout fails before Project-directory probing, template creation, Config loading, or Runtime construction; never auto-fallback.
- All raw external error text is passed through the injected `redact(message)` before entering React state.
- The root `spike/` is experimental, uses static data, and stays outside typecheck, tests, build, package scripts, and the tarball.
- Preserve unrelated user changes. Each task commits only its listed files after its red/green cycle.

## File Structure

Production files:

- `src/ui/tui/run-tui.tsx`: create/destroy renderer and React root, process-level SIGINT, exit Promise, active Prompt settlement.
- `src/ui/tui/tui-app.tsx`: Runtime subscription, command workflows, interaction binding, keyboard/focus behavior, and all initial rendering.
- `src/ui/tui/tui-state.ts`: pure presentation state, reducer, Session snapshot types, ordered live blocks, panels, and notices.
- `src/ui/tui/tui-interactions.ts`: one-pending-request implementation of `UserInteraction`.

Test and experiment files:

- `tests/ui/tui/tui-interactions.test.ts`: answer, cancel, abort, concurrency, and close behavior.
- `tests/ui/tui/tui-state.test.ts`: deterministic event-to-state projection.
- `tests/ui/tui/tui-app.test.tsx`: OpenTUI character frames and keyboard/workflow paths.
- `spike/README.md`, `spike/opentui-react.tsx`: long-lived manual OpenTUI experiment.

Existing integration boundaries:

- `src/coding-agent/cli/args.ts`, `src/main.ts`: startup-only UI selection.
- `tests/coding-agent/cli/args.test.ts`, `tests/main.test.ts`, `tests/import-smoke.test.ts`: startup and import regressions.
- `package.json`, `bun.lock`, `tsconfig.json`, `tsconfig.build.json`, `tests/toolchain.test.ts`: dependency and TSX delivery contract.
- `scripts/verify-dist.ts`, `scripts/verify-global.ts`: compiled and installed-package verification.
- `docs/architecture.md`, `docs/adr/0004-adopt-opentui-react-as-the-default-ui.md`, `docs/TODO.md`, and the design spec: implementation status after all gates pass.

---

### Task 1: Pin OpenTUI/React and establish the TSX compiler boundary

**Files:**

- Modify: `tests/toolchain.test.ts`
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `tsconfig.json`
- Modify: `tsconfig.build.json`

**Interfaces:**

- Produces JSX runtime import source `@opentui/react` for all production/test TSX.
- Produces exact root dependency versions consumed by every later task.
- Keeps `spike/**` excluded by the existing explicit include lists.

- [ ] **Step 1: Add the failing dependency and compiler-contract test**

Extend the package type in `tests/toolchain.test.ts` with `dependencies` and `devDependencies`, then add:

```ts
test("OpenTUI React dependencies and TSX compilation are pinned", async () => {
  const pkg = JSON.parse(await text("package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  expect(pkg.dependencies?.["@opentui/core"]).toBe("0.5.8");
  expect(pkg.dependencies?.["@opentui/react"]).toBe("0.5.8");
  expect(pkg.dependencies?.["react"]).toBe("19.2.8");
  expect(pkg.devDependencies?.["@types/react"]).toBe("19.2.18");
  expect(pkg.dependencies?.["react-dom"]).toBeUndefined();
  expect(pkg.dependencies?.["react-devtools-core"]).toBeUndefined();
  expect(pkg.dependencies?.["ws"]).toBeUndefined();

  const base = JSON.parse(await text("tsconfig.json")) as {
    compilerOptions?: Record<string, unknown>;
    include?: string[];
  };
  const build = JSON.parse(await text("tsconfig.build.json")) as { include?: string[] };
  expect(base.compilerOptions?.["jsx"]).toBe("react-jsx");
  expect(base.compilerOptions?.["jsxImportSource"]).toBe("@opentui/react");
  expect(base.include).toContain("src/**/*.tsx");
  expect(base.include).toContain("tests/**/*.tsx");
  expect(build.include).toContain("src/**/*.tsx");
  expect(base.include?.some((entry) => entry.includes("spike"))).toBe(false);
  expect(build.include?.some((entry) => entry.includes("spike"))).toBe(false);
});
```

- [ ] **Step 2: Run the test and verify the old package boundary fails**

Run:

```powershell
bun test tests/toolchain.test.ts
```

Expected: FAIL on the missing OpenTUI dependency or JSX setting, while the existing Bun-only tests still pass.

- [ ] **Step 3: Install the exact releases and update both TS configs**

Run:

```powershell
bun add --exact @opentui/core@0.5.8 @opentui/react@0.5.8 react@19.2.8
bun add --dev --exact @types/react@19.2.18
bun install --frozen-lockfile
```

Do not add `trustedDependencies`. Add to `tsconfig.json`:

```json
"jsx": "react-jsx",
"jsxImportSource": "@opentui/react"
```

Set its include list to:

```json
["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx", "scripts/**/*.ts"]
```

Set `tsconfig.build.json` include to:

```json
["src/**/*.ts", "src/**/*.tsx"]
```

- [ ] **Step 4: Verify dependency, lockfile, typecheck, and production emit**

Run:

```powershell
bun test tests/toolchain.test.ts
bun run typecheck
bun run build
bun pm untrusted
```

Expected: all commands exit 0. Inspect `package.json` to confirm DevTools/WebSocket are not direct dependencies; their transitive lockfile presence is allowed.

- [ ] **Step 5: Commit**

```powershell
git add package.json bun.lock tsconfig.json tsconfig.build.json tests/toolchain.test.ts
git commit -m "build: add OpenTUI React toolchain"
```

---

### Task 2: Create the long-lived OpenTUI React spike

**Files:**

- Create: `spike/README.md`
- Create: `spike/opentui-react.tsx`
- Modify: `tests/toolchain.test.ts`

**Interfaces:**

- Produces manual command `bun spike/opentui-react.tsx`.
- Uses only static fake data and OpenTUI; it must not import Kea's Runtime.
- Produces no package script, build output, test discovery, or tarball content.

- [ ] **Step 1: Add the failing spike-boundary test**

```ts
test("the OpenTUI spike is manual and outside production", async () => {
  const readme = await text("spike/README.md");
  const source = await text("spike/opentui-react.tsx");
  expect(readme).toContain("bun spike/opentui-react.tsx");
  expect(readme.toLowerCase()).toContain("experimental");
  expect(source).not.toContain("ApplicationRuntime");
  const pkg = JSON.parse(await text("package.json")) as { scripts?: Record<string, string> };
  expect(Object.keys(pkg.scripts ?? {}).some((name) => name.includes("spike"))).toBe(false);
});
```

- [ ] **Step 2: Run the boundary test and observe missing files**

Run `bun test tests/toolchain.test.ts`.

Expected: FAIL because `spike/README.md` does not exist.

- [ ] **Step 3: Implement the static experiment**

`spike/README.md` must label the directory experimental, show the exact command, and list checks for ScrollBox, Enter/Shift+Enter, Select, Ctrl+C, and terminal restoration.

Use the release APIs directly in `spike/opentui-react.tsx`:

```tsx
import { createCliRenderer, SyntaxStyle, type TextareaRenderable } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useRef, useState, type ReactNode } from "react";

const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#d4d4d4" } });
const renderer = await createCliRenderer({
  screenMode: "alternate-screen",
  exitOnCtrlC: false,
  exitSignals: ["SIGTERM", "SIGQUIT", "SIGABRT", "SIGHUP", "SIGPIPE", "SIGBREAK", "SIGBUS"],
});

function Spike(): ReactNode {
  const textarea = useRef<TextareaRenderable>(null);
  const [submitted, setSubmitted] = useState("你好");
  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") renderer.destroy();
  });
  return (
    <box flexDirection="column" height="100%">
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
        <text>KEA</text>
        <box borderStyle="single"><text>{submitted}</text></box>
        <markdown content="**assistant** response" syntaxStyle={syntaxStyle} />
        <text fg="#808080">thinking…</text>
        <text>✓ read_file: static result</text>
      </scrollbox>
      <select
        options={[{ name: "Model A", value: "a" }, { name: "Model B", value: "b" }]}
      />
      <textarea
        ref={textarea}
        placeholder="Ask Kea"
        keyBindings={[
          { name: "return", action: "submit" },
          { name: "return", shift: true, action: "newline" },
        ]}
        onSubmit={() => {
          setSubmitted(textarea.current?.plainText ?? "");
          textarea.current?.clear();
        }}
      />
    </box>
  );
}

const root = createRoot(renderer);
root.render(<Spike />);
await new Promise<void>((resolve) => renderer.once("destroy", () => resolve()));
root.unmount();
syntaxStyle.destroy();
renderer.destroy();
```

- [ ] **Step 4: Verify automated boundaries and perform the manual spike check**

Run:

```powershell
bun test tests/toolchain.test.ts
bun run typecheck
bun run build
bun spike/opentui-react.tsx
```

In the interactive run, verify the full-screen frame, scrolling, selection, Enter submit, Shift+Enter newline, Ctrl+C exit, and restored prompt/scrollback.

- [ ] **Step 5: Commit**

```powershell
git add spike/README.md spike/opentui-react.tsx tests/toolchain.test.ts
git commit -m "test: add OpenTUI React spike"
```

---

### Task 3: Implement the reverse `UserInteraction` adapter

**Files:**

- Create: `src/ui/tui/tui-interactions.ts`
- Create: `tests/ui/tui/tui-interactions.test.ts`

**Interfaces:**

- Consumes: existing `UserInteraction` and `InteractionOptions`.
- Produces: `TuiInteractionRequest`, `TuiInteractions.answer(value)`, `cancel()`, and `close()`.
- The class owns Promise resolvers; React receives only the serializable request descriptor.

- [ ] **Step 1: Write failing request/answer/cancel tests**

Define these exact descriptor shapes in the test imports:

```ts
type TuiInteractionRequest =
  | { readonly kind: "select"; readonly title: string; readonly options: readonly string[] }
  | { readonly kind: "confirm"; readonly title: string; readonly message: string }
  | { readonly kind: "input"; readonly title: string; readonly placeholder: string | undefined };
```

Test that `select()` publishes a descriptor and `answer(1)` resolves `1`; ordinary `cancel()` resolves `undefined`, `false`, and `undefined` for select/confirm/input; input answers are trimmed and blank input is neutral.

- [ ] **Step 2: Run the tests and verify the module is absent**

Run `bun test tests/ui/tui/tui-interactions.test.ts`.

Expected: FAIL because `tui-interactions.ts` cannot be resolved.

- [ ] **Step 3: Implement one-pending-request behavior**

Use this public surface:

```ts
export interface TuiInteractionsOptions {
  readonly show: (request: TuiInteractionRequest | undefined) => void;
}

export class TuiInteractions implements UserInteraction {
  constructor(options: TuiInteractionsOptions);
  select(title: string, options: readonly string[], opts?: InteractionOptions): Promise<number | undefined>;
  confirm(title: string, message: string, opts?: InteractionOptions): Promise<boolean>;
  input(title: string, placeholder?: string, opts?: InteractionOptions): Promise<string | undefined>;
  answer(value: number | boolean | string): void;
  cancel(): void;
  close(): void;
}
```

Internally store exactly one record containing descriptor, neutral value, validator/normalizer, resolve, reject, signal, and abort listener. Opening a second request rejects with `TuiInteractions already has a pending request`. An already-aborted signal rejects with `signal.reason`; a later abort clears the panel/listener and rejects with the same object. `close()` is idempotent and resolves a non-aborted pending request with its neutral value.

- [ ] **Step 4: Add abort, concurrency, invalid-answer, callback-failure, and close tests**

Use an `AbortController` reason object and identity assertion:

```ts
const reason = new Error("cancel run");
const pending = interactions.select("Permission", ["Allow", "Deny"], {
  signal: controller.signal,
});
controller.abort(reason);
await assert.rejects(pending, (error) => error === reason);
```

Also assert a second pending call rejects, an answer of the wrong primitive type rejects the pending call, `show()` failure rejects, `close()` clears the descriptor, and aborting after close has no effect.

- [ ] **Step 5: Run focused tests and typecheck**

```powershell
bun test tests/ui/tui/tui-interactions.test.ts
bun run typecheck
```

Expected: all tests and typecheck pass with no React/OpenTUI import in this module.

- [ ] **Step 6: Commit**

```powershell
git add src/ui/tui/tui-interactions.ts tests/ui/tui/tui-interactions.test.ts
git commit -m "feat: add TUI user interactions"
```

---

### Task 4: Implement the pure TUI projection reducer

**Files:**

- Create: `src/ui/tui/tui-state.ts`
- Create: `tests/ui/tui/tui-state.test.ts`

**Interfaces:**

- Consumes: `AgentMessage`, `ModelConfig`, `HarnessEvent` stream facts, `SessionMetadata`, and `TuiInteractionRequest` types.
- Produces: `createTuiState(snapshot)`, `tuiReducer(state, action)`, `TuiState`, `TuiAction`, and presentation-only panel/live-block types.
- Must not import React, OpenTUI, ApplicationRuntime, or Project.

- [ ] **Step 1: Write failing Session, pending-user, and first-Turn tests**

Lock these primary types in the tests:

```ts
export interface TuiSessionSnapshot {
  readonly id: string;
  readonly title: string;
  readonly model: ModelConfig;
  readonly cwd: string | undefined;
  readonly history: readonly AgentMessage[];
}

export type TuiLiveBlock =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "thinking"; readonly thinking: string }
  | {
      readonly kind: "tool";
      readonly runId: string;
      readonly id: string;
      readonly name: string | undefined;
      readonly argumentsText: string;
      readonly call: AgentToolCall | undefined;
      readonly result: AgentToolResult | undefined;
    };
```

Use these remaining presentation types so later tasks do not invent a second vocabulary:

```ts
export type TuiRunState =
  | { readonly status: "idle" }
  | { readonly status: "running"; readonly runId: string; readonly sawTurnStart: boolean }
  | { readonly status: "completed" | "aborted"; readonly runId: string }
  | { readonly status: "error"; readonly runId: string; readonly message: string };

export type TuiPanel =
  | { readonly kind: "composer" }
  | { readonly kind: "help" }
  | { readonly kind: "sessions"; readonly sessions: readonly SessionMetadata[]; readonly selectedIndex: number }
  | { readonly kind: "providers"; readonly providers: readonly string[]; readonly selectedIndex: number }
  | {
      readonly kind: "models";
      readonly reason: "command" | "initial-repair" | "session-repair";
      readonly models: readonly ModelConfig[];
      readonly selectedIndex: number;
    }
  | {
      readonly kind: "interaction";
      readonly request: TuiInteractionRequest;
      readonly selectedIndex: number;
      readonly input: string;
    };

export interface TuiState {
  readonly session: Omit<TuiSessionSnapshot, "history">;
  readonly history: readonly AgentMessage[];
  readonly composer: string;
  readonly pendingUser: string | undefined;
  readonly liveTurn: readonly TuiLiveBlock[];
  readonly run: TuiRunState;
  readonly panel: TuiPanel;
  readonly notice: string | undefined;
}

export type TuiStreamEvent = Exclude<
  HarnessEvent,
  | { readonly type: "run-start" }
  | { readonly type: "run-end" }
  | { readonly type: "turn-start" }
  | { readonly type: "turn-end" }
>;
```

Assert Session replacement clears transient state; `prompt-submitted` stores the original text and clears composer; first `turn-start` accepts a committed history/title/model snapshot and clears `pendingUser`; later `turn-start` does not replace history.

- [ ] **Step 2: Run the state test and observe the missing reducer**

Run `bun test tests/ui/tui/tui-state.test.ts`.

Expected: FAIL on the missing module.

- [ ] **Step 3: Implement state/action unions and the base reducer**

The action union must distinguish raw safe facts from already-redacted completion:

```ts
export type TuiAction =
  | { readonly type: "session-replaced"; readonly snapshot: TuiSessionSnapshot }
  | { readonly type: "prompt-submitted"; readonly text: string }
  | { readonly type: "run-started"; readonly runId: string }
  | {
      readonly type: "turn-started";
      readonly runId: string;
      readonly committed: Pick<TuiSessionSnapshot, "history" | "title" | "model"> | undefined;
    }
  | { readonly type: "stream-event"; readonly event: TuiStreamEvent }
  | {
      readonly type: "turn-ended";
      readonly runId: string;
      readonly message: AgentMessage;
      readonly toolResults: readonly AgentMessage[];
    }
  | {
      readonly type: "run-ended";
      readonly runId: string;
      readonly reason: "completed" | "aborted" | "error";
      readonly errorMessage: string | undefined;
      readonly committed: Pick<TuiSessionSnapshot, "history" | "title" | "model"> | undefined;
    }
  | { readonly type: "composer-changed"; readonly value: string }
  | { readonly type: "panel-opened"; readonly panel: Exclude<TuiPanel, { readonly kind: "composer" }> }
  | { readonly type: "panel-moved"; readonly delta: number }
  | { readonly type: "panel-input-changed"; readonly value: string }
  | { readonly type: "panel-closed" }
  | { readonly type: "interaction-changed"; readonly request: TuiInteractionRequest | undefined }
  | { readonly type: "notice-changed"; readonly message: string | undefined };
```

`TuiPanel` must explicitly cover composer, help, sessions, providers, models with reason `command | initial-repair | session-repair`, and interaction. Store selection indexes and input text as plain data, never callbacks or Promise resolvers.

- [ ] **Step 4: Add failing ordered-stream and Tool tests, then implement them**

Test text/thinking interleaving, delta without start, and two Tool IDs. Key tools by `(runId, id)`. `tool-call-delta` without start creates a Tool block with `name: undefined`; final `tool-call` fills its structured call/name; `tool-result` fills the result. Compact/full truncation belongs to the view, not the reducer.

- [ ] **Step 5: Add failing Turn/Run finalization tests, then implement them**

Assert `turn-ended` appends exactly `[message, ...toolResults]` and clears live blocks. Assert mismatched run IDs are ignored. Assert `run-ended` clears pending/live state, stores only an already-redacted error string, and uses its committed snapshot only when no Turn began.

- [ ] **Step 6: Run focused tests and typecheck**

```powershell
bun test tests/ui/tui/tui-state.test.ts
bun run typecheck
```

- [ ] **Step 7: Commit**

```powershell
git add src/ui/tui/tui-state.ts tests/ui/tui/tui-state.test.ts
git commit -m "feat: project Harness events for TUI"
```

---

### Task 5: Render the transcript, empty state, composer, and footer

**Files:**

- Create: `src/ui/tui/tui-app.tsx`
- Create: `tests/ui/tui/tui-app.test.tsx`

**Interfaces:**

- Consumes: `ApplicationRuntime`, `TuiInteractions`, and `tuiReducer`.
- Produces: `TuiApp(props)`; no barrel export.
- Props are the only lifecycle callbacks passed by `runTui`:

```ts
export interface TuiAppProps {
  readonly runtime: ApplicationRuntime;
  readonly thinking: "hidden" | "visible";
  readonly toolDetails: "compact" | "full";
  readonly redact: (message: string) => string;
  readonly onExit: () => void;
  readonly trackPrompt: (task: Promise<void> | undefined) => void;
}
```

- [ ] **Step 1: Write the failing empty and conversation character-frame tests**

Create a test-only fake Harness/Project cast to current public types, then use:

```tsx
const setup = await testRender(<TuiApp {...props} />, { width: 100, height: 30 });
try {
  await setup.waitForFrame((frame) => frame.includes("KEA"));
  assert.match(setup.captureCharFrame(), /provider\/model/);
} finally {
  act(() => setup.renderer.destroy());
}
```

The empty frame must contain `KEA`, composer placeholder, real cwd/session/model, and `/help`. A history frame must contain a dark/left-accent user region, assistant Markdown text, configured thinking visibility, Tool facts, and no empty Logo.

- [ ] **Step 2: Run the frame tests and observe the missing app**

Run `bun test tests/ui/tui/tui-app.test.tsx`.

Expected: FAIL because `tui-app.tsx` does not exist.

- [ ] **Step 3: Implement snapshot loading and synchronous event projection**

Add one justified helper, reused only for startup/new/session:

```ts
async function readSessionSnapshot(runtime: ApplicationRuntime): Promise<TuiSessionSnapshot> {
  const harness = runtime.current;
  const metadata = (await runtime.project.listSessions())
    .find((candidate) => candidate.id === harness.sessionId);
  return {
    id: harness.sessionId,
    title: harness.title,
    model: harness.model,
    cwd: metadata?.cwd,
    history: harness.messages,
  };
}
```

Create the reducer from the current synchronous Harness snapshot with `cwd: undefined`, then refresh metadata in an effect. In the Runtime listener, synchronously dispatch every event. On the first `turn-start` of a Run, read `runtime.current.messages/title/model` once and include them in `turn-started`; on `run-end` before that Turn, do the same reconciliation once. Convert `run-end.errorMessage` through `redact` before dispatch. Never await a React frame in the listener.

- [ ] **Step 4: Implement the OpenCode/Pi-style frame**

Use one root column containing a sticky ScrollBox, one bottom slot, and a footer. Use intrinsic `<markdown>` with one memoized `SyntaxStyle.fromStyles(...)`; destroy the style in effect cleanup. Render stored assistant content in source block order, `liveTurn` in source event order, compact Tool text bounded to 200 characters, and full Tool content unbounded. The Logo appears only when history, pending user, and live blocks are all empty.

Configure the Textarea with exact bindings:

```tsx
keyBindings={[
  { name: "return", action: "submit" },
  { name: "kpenter", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "kpenter", shift: true, action: "newline" },
]}
```

- [ ] **Step 5: Test streaming frames, sticky behavior, hidden thinking, and compact/full Tools**

Emit current `HarnessEvent` values through the fake subscription, await a matching frame, and assert that delta order is preserved and final `turn-end` content replaces the draft without duplication. Test `thinking="hidden"` and both Tool modes as separate cases.

- [ ] **Step 6: Verify focused tests and typecheck**

```powershell
bun test tests/ui/tui/tui-app.test.tsx
bun run typecheck
```

- [ ] **Step 7: Commit**

```powershell
git add src/ui/tui/tui-app.tsx tests/ui/tui/tui-app.test.tsx
git commit -m "feat: render the OpenTUI conversation frame"
```

---

### Task 6: Add Prompt, command, selector, and interaction workflows

**Files:**

- Modify: `src/ui/tui/tui-app.tsx`
- Modify: `tests/ui/tui/tui-app.test.tsx`

**Interfaces:**

- Reuses exact `parseInput()` actions: Prompt, `/new`, `/session`, `/model`, `/help`, `/exit`.
- Session/model workflows operate directly on Runtime/Project; they do not call `UserInteraction`.
- `TuiInteractions` is created once in `TuiApp`, bound through Runtime, and closed on unmount.

- [ ] **Step 1: Write failing Prompt and command keyboard paths**

With `mockInput`, test:

```ts
await setup.mockInput.typeText("hello");
setup.mockInput.pressEnter();
await setup.waitFor(() => harness.promptCalls.length === 1);
assert.deepEqual(harness.promptCalls, ["hello"]);
```

Assert immediate pending-user display, no second Prompt while running, `/help` then Escape, `/new`, `/session`, `/model`, command-error notice, and idle `/exit` invoking `onExit` exactly once.

- [ ] **Step 2: Implement Prompt task tracking and errors**

On normal Prompt: dispatch `prompt-submitted`, call `runtime.current.prompt(action.text)`, pass that exact Promise to `trackPrompt`, consume its rejection without duplicating a seen `run-end(error)`, and clear the tracker in `finally`. Only a rejection before any `run-start` becomes one `redact(...)` notice.

All caught Session/model/action failures become:

```ts
const message = error instanceof Error ? error.message : String(error);
dispatch({ type: "notice-changed", message: redact(message) });
```

- [ ] **Step 3: Implement explicit panel state machines**

- `/session`: load newest-first metadata, open the sessions panel, then call `runtime.switchSession(id)` and `readSessionSnapshot()` on selection.
- `/model`: open providers, then filtered models; call `project.switchModel(runtime.current, selection)` and refresh the snapshot.
- Startup invalid model: open all-model repair; Escape calls `onExit`.
- Invalid model after `/new` or `/session`: keep the activated Session, open repair, and on Escape leave Prompt disabled with `use /model before prompting`.
- `/help`: replace the composer with the five-command help panel.

No panel state may contain callbacks or Promise resolvers.

- [ ] **Step 4: Add failing `UserInteraction` panel paths, then connect the adapter**

Create `TuiInteractions` with a `show` callback dispatching `interaction-changed`. Test a permission `select`, confirm, input, Escape neutral cancellation, and AbortSignal rejection. Session/model selectors may share the visual Select component but must use their own panel variants.

- [ ] **Step 5: Implement global keyboard/focus behavior**

Use `useKeyboard` for:

- Ctrl+C while running: `runtime.current.abort()` only.
- Ctrl+C in a panel: cancel the panel/interaction.
- Ctrl+C in idle composer: clear Textarea/state, not exit.
- Escape: close a local/help panel or neutrally cancel interaction, then focus composer.
- `/exit`: effective only from idle composer.

Call `preventDefault()` and `stopPropagation()` for consumed global keys so Textarea/Select do not also process them. Use Select `onChange` only for highlight and `onSelect` for confirmation.

- [ ] **Step 6: Run every TUI test and typecheck**

```powershell
bun test tests/ui/tui
bun run typecheck
```

- [ ] **Step 7: Commit**

```powershell
git add src/ui/tui/tui-app.tsx tests/ui/tui/tui-app.test.tsx
git commit -m "feat: add TUI command workflows"
```

---

### Task 7: Bracket the renderer and React lifecycle in `runTui`

**Files:**

- Create: `src/ui/tui/run-tui.tsx`
- Modify: `tests/import-smoke.test.ts`
- Modify: `tests/ui/tui/tui-app.test.tsx`

**Interfaces:**

- Produces the only TUI production entry:

```ts
export async function runTui(
  runtime: ApplicationRuntime,
  options: {
    readonly thinking: "hidden" | "visible";
    readonly toolDetails: "compact" | "full";
    readonly redact: (message: string) => string;
  },
): Promise<void>;
```

- Does not export a handle, renderer, root, interaction, factory, or common UI interface.

- [ ] **Step 1: Add a failing side-effect-free import test**

Rename the current main import test to `production main import is silent and side-effect free`. Add a subprocess import of `src/ui/tui/run-tui.tsx` that records listener counts for `SIGINT`, `SIGTERM`, `SIGHUP`, and `SIGQUIT` before/after import and asserts no stdout/stderr. Set a finite subprocess timeout.

- [ ] **Step 2: Run the import test and observe the absent module**

Run `bun test tests/import-smoke.test.ts`.

Expected: FAIL because the TUI entry cannot be imported.

- [ ] **Step 3: Implement the bracketed lifecycle**

Use these renderer settings:

```ts
const EXIT_SIGNALS: NodeJS.Signals[] = [
  "SIGTERM", "SIGQUIT", "SIGABRT", "SIGHUP", "SIGPIPE", "SIGBREAK", "SIGBUS",
];

const renderer = await createCliRenderer({
  screenMode: "alternate-screen",
  exitOnCtrlC: false,
  exitSignals: EXIT_SIGNALS,
  consoleMode: "disabled",
  onDestroy: requestExit,
});
```

Install Kea's process `SIGINT` listener inside `runTui` before awaiting renderer creation. It calls `requestExit`, which latches exit, aborts a running Harness, and resolves the exit Promise. Track the current Prompt Promise in one closure variable passed to `TuiApp`.

In `finally`, execute this exact order even after partial initialization:

1. Latch exit and capture the active Prompt Promise.
2. Abort a running Harness.
3. Unmount an existing root.
4. Destroy a non-destroyed renderer.
5. Remove Kea's SIGINT listener only after renderer destruction.
6. Await the captured Prompt Promise and consume its already-rendered rejection.

Let initialization/lifecycle failures rethrow after cleanup. Do not print, import Config, or fallback to CLI.

- [ ] **Step 4: Verify app cleanup contracts**

Extend the App test to destroy the renderer inside React `act()` while an interaction is pending. Assert Runtime unsubscribe, `TuiInteractions.close()`, and `SyntaxStyle.destroy()` effects ran. Test that `trackPrompt` receives and later clears the exact Prompt Promise.

- [ ] **Step 5: Run import/TUI tests and typecheck**

```powershell
bun test tests/import-smoke.test.ts tests/ui/tui
bun run typecheck
```

- [ ] **Step 6: Commit**

```powershell
git add src/ui/tui/run-tui.tsx tests/import-smoke.test.ts tests/ui/tui/tui-app.test.tsx
git commit -m "feat: run the OpenTUI React lifecycle"
```

---

### Task 8: Add explicit startup UI selection while keeping temporary CLI default

**Files:**

- Modify: `src/coding-agent/cli/args.ts`
- Modify: `src/main.ts`
- Modify: `tests/coding-agent/cli/args.test.ts`
- Modify: `tests/main.test.ts`
- Modify: `tests/import-smoke.test.ts`

**Interfaces:**

- Produces `Args.ui: "tui" | "cli"` from the existing `parseArgs()`.
- Accepts only separate-token `--ui tui` and `--ui cli`.
- Dynamically imports `runTui` only in the TUI branch.

- [ ] **Step 1: Add failing Args tests with temporary CLI default**

Assert:

```ts
assert.equal(parseArgs([]).ui, "cli");
assert.equal(parseArgs(["--ui", "tui"]).ui, "tui");
assert.equal(parseArgs(["--ui", "cli"]).ui, "cli");
assert.match(messages(parseArgs(["--ui"])), /Missing value for --ui/);
assert.match(messages(parseArgs(["--ui", "cli", "--ui", "tui"])), /Duplicate option: --ui/);
assert.match(messages(parseArgs(["--ui", "other"])), /Invalid value for --ui: other/);
assert.match(messages(parseArgs(["--ui=tui"])), /Unknown option: --ui=tui/);
```

Update existing deep-equality expectations with `ui: "cli"`.

- [ ] **Step 2: Implement parsing without a helper abstraction**

Add the full field and locals:

```ts
export interface Args {
  readonly continue: boolean;
  readonly config?: string;
  readonly verbose: boolean;
  readonly ui: "tui" | "cli";
  readonly directory: string;
  readonly diagnostics: readonly Diagnostic[];
}

let ui: "tui" | "cli" = "cli";
let uiSpecified = false;
```

Parse `--ui` inline. `uiSpecified` is required to detect a duplicate explicit CLI value; invalid/missing input records diagnostics and leaves the internal default valid.

- [ ] **Step 3: Add and implement explicit-TUI non-TTY preflight**

In a real subprocess, pass `--ui tui`, a nonexistent directory, and a fresh HOME. Assert status 1, stderr contains `interactive stdin and stdout` plus `--ui cli`, no missing-directory error, no template output, and no `.kea` directory.

Place this directly after diagnostic handling in `main`:

```ts
if (args.ui === "tui" && (!process.stdin.isTTY || !process.stdout.isTTY)) {
  console.error("error: TUI requires interactive stdin and stdout; use --ui cli");
  process.exitCode = 1;
  return;
}
```

- [ ] **Step 4: Test dynamic branch selection and redacted TUI failure**

Use a subprocess `Bun.plugin()` to redirect `./ui/tui/run-tui.js` to a test namespace. Set stdin/stdout `isTTY` to true before calling exported `main()`. A fake TUI module prints a marker for `--ui tui`; a second fake throws on module evaluation and must remain unloaded for `--ui cli`. With a valid temporary Config containing API key `secret-key`, make fake `runTui()` throw `lifecycle exposed secret-key`; assert one `[REDACTED]`, no secret, and status 1.

- [ ] **Step 5: Implement the approved single `try/catch/finally` composition**

```ts
try {
  if (args.ui === "cli") {
    const ui = new CliUi(applicationRuntime, {
      thinking: config.thinking,
      toolDetails: config.toolDetails,
      reportError,
    });
    applicationRuntime.bindUserInteraction(ui.interactions);
    await ui.run().finally(() => ui.close());
  } else {
    const { runTui } = await import("./ui/tui/run-tui.js");
    await runTui(applicationRuntime, {
      thinking: config.thinking,
      toolDetails: config.toolDetails,
      redact: (message) => config.redact(message),
    });
  }
} catch (error) {
  reportError(error);
  process.exitCode = 1;
} finally {
  applicationRuntime.close();
}
```

Do not pass `config.redact` unbound and do not statically export/import the TUI from `src/ui/index.ts` or `src/index.ts`.

- [ ] **Step 6: Verify focused and full source tests**

```powershell
bun test tests/coding-agent/cli/args.test.ts tests/main.test.ts tests/import-smoke.test.ts
bun run typecheck
bun test
```

- [ ] **Step 7: Commit**

```powershell
git add src/coding-agent/cli/args.ts src/main.ts tests/coding-agent/cli/args.test.ts tests/main.test.ts tests/import-smoke.test.ts
git commit -m "feat: select CLI or TUI at startup"
```

---

### Task 9: Pass the parity gate and atomically make TUI the default

**Files:**

- Modify: `src/coding-agent/cli/args.ts`
- Modify: `tests/coding-agent/cli/args.test.ts`
- Modify: `tests/main.test.ts`
- Modify: `scripts/verify-dist.ts`
- Modify: `scripts/verify-global.ts`

**Interfaces:**

- Changes only the omitted-`--ui` default from CLI to TUI.
- Keeps explicit CLI bootstrap/delivery probes and adds default non-TTY probes.
- Verifies compiled and globally installed TUI module imports without side effects.

- [ ] **Step 1: Change tests to demand the final default**

Rename the temporary Args test to `UI defaults to TUI after the parity gate`, expect `ui: "tui"` in every no-UI parse result, and add `default TUI fails before user configuration in a non-interactive terminal`. The default subprocess must leave a fresh HOME without `.kea` and print `--ui cli`.

Rename the existing bootstrap test to `explicit CLI without user configuration falls back to init templates` and pass `[MAIN_PATH, "--ui", "cli"]`.

- [ ] **Step 2: Run the startup tests and verify the temporary default fails**

```powershell
bun test tests/coding-agent/cli/args.test.ts tests/main.test.ts
```

Expected: FAIL because `parseArgs([]).ui` is still `cli`.

- [ ] **Step 3: Switch the one default initializer**

Change only:

```ts
let ui: "tui" | "cli" = "tui";
```

- [ ] **Step 4: Extend compiled/global delivery verification**

In `verify-dist.ts` assert `dist/src/ui/tui/run-tui.js` exists, `dist/spike` does not, and compiled TUI import is silent with unchanged signal listener counts. Run the existing Config-template probe with `[mainPath, "--ui", "cli"]`; add a separate no-args/fresh-HOME non-TTY failure assertion.

In `verify-global.ts` require the packed/installed TUI module, import it from the isolated global install with unchanged signal listener counts, and verify the installed launcher twice: no args fails before Config with `--ui cli`, then explicit CLI creates templates. For Windows `.cmd`, use `"${launcher}" --ui cli`; on other platforms pass `["--ui", "cli"]`.

- [ ] **Step 5: Run the complete local delivery graph**

```powershell
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
bun run verify:dist
bun run verify:global
git diff --check
```

Expected: complete success; the source test summary must report zero failures.

- [ ] **Step 6: Perform the Windows Terminal parity smoke**

Run both `bun src/main.ts --ui tui` and `bun src/main.ts --ui cli`. In TUI verify Logo/empty state, Prompt streaming, thinking modes, compact/full Tool display, permission select, `/new`, `/session`, `/model`, `/help`, Ctrl+C abort, `/exit`, process SIGINT, crash recovery, and restored terminal. Record any gap; do not accept the default switch while a gap remains.

- [ ] **Step 7: Commit the default and local delivery gate**

```powershell
git add src/coding-agent/cli/args.ts tests/coding-agent/cli/args.test.ts tests/main.test.ts scripts/verify-dist.ts scripts/verify-global.ts
git commit -m "feat: make TUI the default interface"
```

---

### Task 10: Confirm three-platform delivery and synchronize current architecture

**Files:**

- Modify after evidence: `docs/superpowers/specs/2026-08-24-opentui-tui-design.md`
- Modify after evidence: `docs/adr/0004-adopt-opentui-react-as-the-default-ui.md`
- Modify after evidence: `docs/architecture.md`
- Modify after evidence: `docs/TODO.md`

**Interfaces:**

- Converts accepted/pending documentation into current implemented truth only after all delivery evidence exists.
- Does not change production code.

- [ ] **Step 1: Obtain supported-platform evidence**

On the integrated commit, verify GitHub Actions jobs `verify (windows-latest)`, `verify (ubuntu-latest)`, and `verify (macos-latest)` all pass the existing frozen-install/typecheck/test/build/dist/global graph. GitLab Linux is additional evidence, not a substitute for the three GitHub jobs. If the agent lacks push/CI authority, stop here and request that evidence; do not mark implementation complete.

- [ ] **Step 2: Update the design and ADR status**

Change the design status from `设计已确认，尚未实施。` to `已实施并通过等价与交付门。`. Change ADR front matter from `implementation: pending` to `implementation: complete`. Append concise evidence: exact dependency versions, local verification commands, Windows manual smoke, and three CI job results.

- [ ] **Step 3: Rewrite architecture as current truth**

Replace `已接受的 TUI 迁移目标（尚未实施）` with the actual four-module TUI structure, final `main.ts` UI selection order, dynamic import, state projection, interaction ownership, and cleanup order. Update the numbered startup sequence so default TUI and explicit CLI are current behavior, not future language.

- [ ] **Step 4: Close the TODO and run documentation checks**

Mark only the OpenTUI React TUI item complete. Do not alter unrelated TODOs. Run:

```powershell
git diff --check
rg -n "尚未实施|implementation: pending|当前 revision 仍只有" docs/architecture.md docs/adr/0004-adopt-opentui-react-as-the-default-ui.md docs/superpowers/specs/2026-08-24-opentui-tui-design.md
```

Expected: `git diff --check` exits 0 and the targeted stale-implementation scan prints no matches.

- [ ] **Step 5: Commit current architectural truth**

```powershell
git add docs/superpowers/specs/2026-08-24-opentui-tui-design.md docs/adr/0004-adopt-opentui-react-as-the-default-ui.md docs/architecture.md docs/TODO.md
git commit -m "docs: record the implemented TUI architecture"
```

---

## Final Acceptance Checklist

- [ ] No-args Kea enters OpenTUI in an interactive terminal; `--ui cli` permanently retains readline behavior.
- [ ] Only `--ui tui` and `--ui cli` are accepted; no equals form, alias, persisted mode, or runtime switch exists.
- [ ] CLI mode does not statically load OpenTUI; TUI and main imports have no renderer, signal, or output side effects.
- [ ] Prompt, five slash commands, Session/model repair, permission interactions, streaming, thinking, Tools, abort, and exit match the design.
- [ ] `HarnessEvent`, `UserInteraction`, Runtime/Project/Harness ownership, and current command grammar are unchanged.
- [ ] Every raw external error is redacted before React state; Prompt failures render once.
- [ ] Renderer/root/style/interactions/subscriptions restore on normal exit, SIGINT, other renderer signals, init failure, and test teardown.
- [ ] `runTui()` waits for an aborted active Prompt before allowing Runtime close.
- [ ] Spike remains manual and excluded from typecheck, source tests, dist, and tarball.
- [ ] Source tests, typecheck, build, dist verification, global verification, Windows smoke, and three-platform CI all pass.
- [ ] ADR-0004, ADR index, architecture, design status, and TODO match implemented code.

## Official OpenTUI References

- Runtime support: https://opentui.com/docs/getting-started/runtime-support/
- Renderer and lifecycle: https://opentui.com/docs/core-concepts/renderer/ and https://opentui.com/docs/core-concepts/lifecycle/
- React binding/root: https://opentui.com/docs/bindings/react/
- Keyboard: https://opentui.com/docs/core-concepts/keyboard/
- Testing: https://opentui.com/docs/core-concepts/testing/
- ScrollBox: https://opentui.com/docs/components/scrollbox/
- Textarea: https://opentui.com/docs/components/textarea/
- Select: https://opentui.com/docs/components/select/
- Markdown: https://opentui.com/docs/components/markdown/
- OpenTUI 0.5.8 release package source: https://github.com/anomalyco/opentui/tree/21b002174255ca2236ed3115e2bb2294642f2cf5/packages
