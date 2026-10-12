# Application UserInteraction Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ApplicationRuntime` directly own a replaceable `UserInteraction`, default it to safe non-interactive behavior, and bind CLI interaction explicitly after both Runtime and UI exist.

**Architecture:** `ApplicationRuntime` implements the stable `UserInteraction` surface and delegates each call to its current `interaction`, initially `NoUserInteraction`. Project no longer stores interaction state; it receives the Runtime only when constructing Harness hooks. `main` creates Runtime, creates CLI, binds `ui.interactions`, then starts the CLI.

**Tech Stack:** TypeScript 7, Node.js 24, Node built-in test runner, existing ApplicationRuntime, Project, AgentHarness, Permission, and CLI APIs.

**Spec:** `docs/superpowers/specs/2026-08-23-application-user-interaction-lifecycle-design.md`

## Global Constraints

- `ApplicationRuntime` is the only owner of the current `UserInteraction` reference.
- A new Runtime starts with `NoUserInteraction`; missing UI never throws.
- `Project` has no current Interaction field and no bind/unbind operation.
- Do not introduce `UserInteractionBinding`, `InteractionSlot`, availability flags, PermissionPolicy, Service containers, or event types.
- Keep `ApplicationRuntime.project` and `ApplicationRuntime.current` public.
- Keep direct Project/Harness usage; do not add proxy methods.
- Keep the repository's single foreground Harness and non-concurrent interaction model.
- Add no npm dependencies.
- Do not perform git operations unless the user explicitly requests them.

## File Map

- Modify: `src/coding-agent/interaction/interactions.ts`
- Modify: `tests/coding-agent/interaction/interactions.test.ts`
- Modify: `tests/coding-agent/hooks/permission/permission.test.ts`
- Modify: `src/coding-agent/project/project.ts`
- Modify: `src/coding-agent/factory.ts`
- Modify: `tests/coding-agent/project/factory.test.ts`
- Modify: `src/coding-agent/application-runtime.ts`
- Modify: `tests/coding-agent/application-runtime.test.ts`
- Modify: `src/coding-agent/index.ts`
- Modify: `src/ui/cli/cli-ui.ts`
- Modify: `tests/ui/cli/cli-ui.test.ts`
- Modify: `src/main.ts`
- Modify: `tests/main.test.ts`
- Modify: `src/coding-agent/README.md`
- Modify: `src/coding-agent/docs/project.md`
- Modify: `src/coding-agent/docs/startup.md`
- Modify: `docs/superpowers/specs/2026-08-23-application-runtime-design.md`

---

### Task 1: Define the safe default UserInteraction

**Files:**

- Modify: `src/coding-agent/interaction/interactions.ts`
- Modify: `tests/coding-agent/interaction/interactions.test.ts`
- Modify: `tests/coding-agent/hooks/permission/permission.test.ts`

**Interfaces:**

- Consumes: existing `UserInteraction` and `InteractionOptions`.
- Produces: `NoUserInteraction implements UserInteraction`.
- Removes: `UserInteractionBinding` and its unbound-error behavior.

- [ ] **Step 1: Replace Binding tests with default-result tests**

Add focused assertions to `tests/coding-agent/interaction/interactions.test.ts`:

```ts
import { NoUserInteraction } from "../../../src/coding-agent/interaction/interactions.js";

test("NoUserInteraction returns safe non-interactive answers", async () => {
  const interaction = new NoUserInteraction();

  assert.equal(await interaction.select("choose", ["yes"]), undefined);
  assert.equal(await interaction.confirm("confirm", "continue?"), false);
  assert.equal(await interaction.input("input", "value"), undefined);
});
```

- [ ] **Step 2: Add Permission regression coverage for the default**

Add this case to `tests/coding-agent/hooks/permission/permission.test.ts`:

```ts
test("NoUserInteraction denies requests that require approval", async () => {
  const interaction = new NoUserInteraction();

  assert.deepEqual(
    await decide(bashEvent("rm file.txt"), interaction),
    { kind: "deny", reason: "Permission denied by user" },
  );
  assert.deepEqual(
    await decide(bashEvent("echo hello"), interaction),
    { kind: "allow" },
  );
});
```

Import `NoUserInteraction` from the Interaction module in the same test file.

- [ ] **Step 3: Run the focused tests and confirm RED**

Run:

```bash
npm run build
node --test dist/tests/coding-agent/interaction/interactions.test.js dist/tests/coding-agent/hooks/permission/permission.test.js
```

Expected: build or tests fail because `NoUserInteraction` is missing or the old Binding behavior remains.

- [ ] **Step 4: Implement NoUserInteraction and delete UserInteractionBinding**

Use this implementation in `src/coding-agent/interaction/interactions.ts`:

```ts
export class NoUserInteraction implements UserInteraction {
  async select(): Promise<undefined> {
    return undefined;
  }

  async confirm(): Promise<false> {
    return false;
  }

  async input(): Promise<undefined> {
    return undefined;
  }
}
```

Delete the complete `UserInteractionBinding` class. Do not add `available`, `hasUI`, a singleton registry, or error throwing.

- [ ] **Step 5: Run the focused tests and confirm GREEN**

Run the Step 3 commands again.

Expected: both focused test files pass; approval-required operations deny and ordinary operations remain allowed.

---

### Task 2: Remove Project ownership and make ApplicationRuntime the interaction surface

**Files:**

- Modify: `src/coding-agent/project/project.ts`
- Modify: `src/coding-agent/factory.ts`
- Modify: `tests/coding-agent/project/factory.test.ts`
- Modify: `src/coding-agent/application-runtime.ts`
- Modify: `tests/coding-agent/application-runtime.test.ts`
- Modify: `src/coding-agent/index.ts`

**Interfaces:**

- Consumes: Task 1 `NoUserInteraction`, existing Project Harness construction, and existing Runtime Session replacement/subscription behavior.
- Produces: `ApplicationRuntime implements UserInteraction`, `ApplicationRuntime.create(project, continueSession)`, and `bindUserInteraction(interaction): void`.
- Produces: `Project.createHarness(interaction, options?)` and `Project.createHarnessFromSession(sessionId, interaction)`.
- Removes: Project constructor/factory `interaction` option and Project `interaction` field.

- [ ] **Step 1: Change Project tests to pass Interaction per Harness**

Update every Project test that constructs a Harness:

```ts
const harness = await project.createHarness(testInteractions);
const restored = await project.createHarnessFromSession(sessionId, testInteractions);
```

Remove `interaction: testInteractions` from the `openOrCreateProject()` test helper.

- [ ] **Step 2: Add Runtime default and replacement tests**

Add a recording adapter in `tests/coding-agent/application-runtime.test.ts`:

```ts
class RecordingInteraction implements UserInteraction {
  readonly selections: string[] = [];

  async select(title: string): Promise<number | undefined> {
    this.selections.push(title);
    return 0;
  }

  async confirm(): Promise<boolean> {
    return true;
  }

  async input(): Promise<string | undefined> {
    return "value";
  }
}
```

Add these behaviors:

```ts
test("ApplicationRuntime defaults to NoUserInteraction", async () => {
  const initial = makeHarness("initial");
  const interactionArguments: UserInteraction[] = [];
  const project = {
    listSessions: async () => [],
    createHarness: async (interaction: UserInteraction) => {
      interactionArguments.push(interaction);
      return initial.harness;
    },
  } as unknown as Project;
  const runtime = await ApplicationRuntime.create(project, false);

  assert.equal(await runtime.select("permission", ["allow"]), undefined);
  assert.equal(await runtime.confirm("permission", "allow?"), false);
  assert.equal(await runtime.input("permission"), undefined);
  assert.deepEqual(interactionArguments, [runtime]);
});

test("bindUserInteraction replaces the Runtime interaction", async () => {
  const initial = makeHarness("initial");
  const project = {
    listSessions: async () => [],
    createHarness: async () => initial.harness,
  } as unknown as Project;
  const runtime = await ApplicationRuntime.create(project, false);
  const interaction = new RecordingInteraction();

  runtime.bindUserInteraction(interaction);

  assert.equal(await runtime.select("permission", ["allow"]), 0);
  assert.deepEqual(interaction.selections, ["permission"]);
});
```

Change the existing `makeProject()` helper signatures to accept and record the
new arguments:

```ts
function makeProject(options: {
  readonly initial: AgentHarness;
  readonly created?: AgentHarness;
  readonly restored?: AgentHarness;
  readonly interactions?: UserInteraction[];
  readonly createError?: Error;
  readonly restoreError?: Error;
  readonly restoredIds?: string[];
  readonly createCalls?: { count: number };
}): Project {
  let initialPending = true;
  return {
    listSessions: async () => [],
    createHarness: async (interaction: UserInteraction) => {
      options.interactions?.push(interaction);
      if (initialPending) {
        initialPending = false;
        return options.initial;
      }
      if (options.createCalls !== undefined) options.createCalls.count += 1;
      if (options.createError !== undefined) throw options.createError;
      if (options.created === undefined) throw new Error("missing created Harness");
      return options.created;
    },
    createHarnessFromSession: async (
      sessionId: string,
      interaction: UserInteraction,
    ) => {
      options.interactions?.push(interaction);
      options.restoredIds?.push(sessionId);
      if (options.restoreError !== undefined) throw options.restoreError;
      if (options.restored === undefined) throw new Error("missing restored Harness");
      return options.restored;
    },
  } as unknown as Project;
}
```

For tests that exercise `continueSession: true`, provide `listSessions()` with
the requested Session metadata and assert that
`createHarnessFromSession(sessionId, runtime)` receives the returned Runtime.

- [ ] **Step 3: Run Project and Runtime tests and confirm RED**

Run:

```bash
npm run build
node --test dist/tests/coding-agent/project/factory.test.js dist/tests/coding-agent/application-runtime.test.js
```

Expected: compile failures show the old Project constructor ownership, old Harness signatures, and missing Runtime interaction methods.

- [ ] **Step 4: Remove Interaction from Project state**

Change the Project API to:

```ts
async createHarness(
  interaction: UserInteraction,
  options?: { readonly cwd?: string },
): Promise<AgentHarness>;

async createHarnessFromSession(
  sessionId: string,
  interaction: UserInteraction,
): Promise<AgentHarness>;
```

Pass the method argument into:

```ts
private buildHarness(session: Session, interaction: UserInteraction): AgentHarness {
  return new AgentHarness({
    session,
    runtime: this.runtime,
    modelConfig: this.modelConfig,
    maxTurns: this.maxTurns,
    toolRegistry: createBuiltinToolRegistry(
      session.metadata.cwd,
      this.toolTimeoutSeconds,
    ),
    systemPrompt: createSystemPrompt(
      this.projectDirectory,
      session.metadata.cwd,
    ),
    events: new HarnessEventBus(),
    hooks: createHooks({
      approved: this.approved,
      interaction,
      trustedDirectories: [this.projectDirectory],
    }),
  });
}
```

Delete `private readonly interaction`, the Project constructor option, the assignment, and the corresponding `openOrCreateProject()` option.

- [ ] **Step 5: Make ApplicationRuntime own and forward UserInteraction**

Implement this public shape while preserving existing `project`, `current`,
`newSession`, `switchSession`, `subscribe`, and `close` behavior:

```ts
export class ApplicationRuntime implements UserInteraction {
  readonly project: Project;
  private interaction: UserInteraction = new NoUserInteraction();
  private currentHarness!: AgentHarness;

  private constructor(project: Project) {
    this.project = project;
  }

  static async create(
    project: Project,
    continueSession: boolean,
  ): Promise<ApplicationRuntime> {
    const runtime = new ApplicationRuntime(project);
    const sessions = continueSession ? await project.listSessions() : [];
    const newest = sessions[0];
    runtime.currentHarness = newest === undefined
      ? await project.createHarness(runtime)
      : await project.createHarnessFromSession(newest.id, runtime);
    return runtime;
  }

  bindUserInteraction(interaction: UserInteraction): void {
    this.assertOpen();
    this.interaction = interaction;
  }
}
```

Implement `select`, `confirm`, and `input` with the exact `UserInteraction`
signatures and direct delegation to `this.interaction`.

Update Session replacement calls:

```ts
return this.replaceCurrent(() => this.project.createHarness(this));
return this.replaceCurrent(
  () => this.project.createHarnessFromSession(sessionId, this),
);
```

At the end of `close()`, assign `this.interaction = new NoUserInteraction()`.
Do not retain a Binding field or bind callback.

- [ ] **Step 6: Simplify createApplicationRuntime**

Remove `UserInteractionBinding` construction from `src/coding-agent/factory.ts`.
After opening Project without an interaction option, return:

```ts
return ApplicationRuntime.create(project, options.continueSession);
```

Remove duplicate initial Session selection from the factory. Keep
`openOrCreateProject()` internal to the module and keep
`createApplicationRuntime()` as the public barrel export.

- [ ] **Step 7: Run Project and Runtime tests and confirm GREEN**

Run the Step 3 commands again.

Expected: Project and Runtime tests pass, including existing Session replacement and subscription migration coverage.

---

### Task 3: Bind CLI interaction explicitly in main

**Files:**

- Modify: `src/ui/cli/cli-ui.ts`
- Modify: `tests/ui/cli/cli-ui.test.ts`
- Modify: `src/main.ts`
- Modify: `tests/main.test.ts`

**Interfaces:**

- Consumes: Task 2 `createApplicationRuntime()` and `bindUserInteraction()`.
- Produces: `CliUi.interactions` and `CliUi.run(runtime)` with explicit composition in `main`.
- Removes: constructor-time Runtime binding and UI-owned unbind callback.

- [ ] **Step 1: Update CLI tests to the explicit lifecycle**

Change the shared UI construction path to:

```ts
async function createRuntime(
  project: Project,
  initial: AgentHarness,
): Promise<ApplicationRuntime> {
  let initialPending = true;
  const createHarness = project.createHarness.bind(project);
  const runtimeProject = {
    ...project,
    createHarness: async (
      interaction: UserInteraction,
      options?: { readonly cwd?: string },
    ) => {
      if (initialPending) {
        initialPending = false;
        return initial;
      }
      return createHarness(interaction, options);
    },
  } as Project;
  return ApplicationRuntime.create(runtimeProject, false);
}

const applicationRuntime = await createRuntime(project, asHarness(initial));
const ui = makeUi({ readline, calls });
applicationRuntime.bindUserInteraction(ui.interactions);
await ui.run(applicationRuntime);
```

Update the existing `"the outer loop waits for a Run"` test so its fake Harness
calls `applicationRuntime.select(...)` rather than calling `ui.interactions`
directly:

```ts
harness.prompt = async () => {
  calls.push("prompt:start");
  await applicationRuntime.select(
    "\u26a0 needs approval\n   rm -rf /tmp/x",
    ["Allow once", "Always allow", "Deny"],
  );
  calls.push("prompt:end");
};
```

The existing expected call order remains unchanged, proving that the Runtime
delegates to the bound CLI adapter. Keep all existing prompt, model, Session,
SIGINT, renderer, EOF, and idempotent-close assertions.

- [ ] **Step 2: Update main composition expectations**

Delete the obsolete `selectInitialHarness` import, fake Project/Harness helpers,
and `"continue opens the newest Session"` test from `tests/main.test.ts`.
Initial Session selection is now covered by `ApplicationRuntime.create()` tests.
Keep the existing silent-import and configuration-template process tests.

The source composition sequence to enforce through TypeScript compilation and
the focused Runtime/CLI tests is:

```text
createApplicationRuntime
create CliUi
bindUserInteraction(ui.interactions)
ui.run(applicationRuntime)
ui.close
applicationRuntime.close
```

Preserve diagnostics, configuration, redaction, and main-module import behavior.

- [ ] **Step 3: Run CLI and main tests and confirm RED**

Run:

```bash
npm run build
node --test dist/tests/ui/cli/cli-ui.test.js dist/tests/main.test.js
```

Expected: compile failures show the current constructor-time binding and missing public `ui.interactions`.

- [ ] **Step 4: Restore CliUi to a UI-only constructor**

Use this public shape:

```ts
export class CliUi {
  readonly interactions: CliInteractions;

  constructor(options: CliUiOptions);
  async run(runtime: ApplicationRuntime): Promise<void>;
}
```

Delete constructor-time `runtime.bindInteraction()`, the stored unbind
callback, and unbinding from `close()`. Keep Runtime event unsubscribe and
readline close behavior unchanged. Move the existing `CliInteractions`
construction back to `this.interactions = new CliInteractions(...)`; change
only the constructor parameter list and `run()` parameter list around the
existing constructor and loop bodies.

- [ ] **Step 5: Wire the exact production order in main**

Use:

```ts
const applicationRuntime = await createApplicationRuntime({
  keaHome,
  projectDirectory,
  providers: config.runtimeProviders(),
  modelConfig: config.defaultModel,
  models: config.models,
  continueSession: args.continue,
  maxTurns: config.maxTurns,
  toolTimeoutSeconds: config.toolTimeoutSeconds,
});
const ui = new CliUi({
  thinking: config.thinking,
  toolDetails: config.toolDetails,
  reportError,
});
applicationRuntime.bindUserInteraction(ui.interactions);

try {
  await ui.run(applicationRuntime);
} finally {
  ui.close();
  applicationRuntime.close();
}
```

- [ ] **Step 6: Run CLI and main tests and confirm GREEN**

Run the Step 3 commands again.

Expected: CLI and main tests pass with one explicit application-level bind.

---

### Task 4: Align documentation and verify the complete repository

**Files:**

- Modify: `src/coding-agent/README.md`
- Modify: `src/coding-agent/docs/project.md`
- Modify: `src/coding-agent/docs/startup.md`
- Modify: `docs/superpowers/specs/2026-08-23-application-runtime-design.md`

**Interfaces:**

- Consumes: completed Tasks 1 through 3.
- Produces: documentation that describes ApplicationRuntime ownership and the explicit Runtime/UI/bind startup sequence.

- [ ] **Step 1: Update Coding Agent documentation**

Document these exact facts:

```text
ApplicationRuntime owns current UserInteraction.
ApplicationRuntime starts with NoUserInteraction.
Project does not own or bind UserInteraction.
Harness construction receives ApplicationRuntime as its UserInteraction surface.
main creates Runtime, creates UI, binds ui.interactions, then runs UI.
No UI causes approval-required Permission requests to deny without throwing.
```

Remove examples that pass `interaction` into `openOrCreateProject()` or claim
that Project owns the external interaction port.

- [ ] **Step 2: Mark the older Runtime spec as superseded for Interaction ownership**

Add a short status note to
`docs/superpowers/specs/2026-08-23-application-runtime-design.md` linking to the
new lifecycle spec. Do not rewrite unrelated Harness activation, subscription,
Project, or UI decisions in that document.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit code 0 with no TypeScript diagnostics.

- [ ] **Step 4: Run the complete test suite**

Run:

```bash
npm test
```

Expected: build succeeds and all tests pass, with only the repository's existing intentional skips.

- [ ] **Step 5: Check final invariants from source and tests**

Confirm all of the following from the implementation and passing tests:

```text
No UserInteractionBinding symbol remains.
No InteractionSlot symbol exists.
Project has no interaction field or constructor option.
ApplicationRuntime has one current interaction field.
ApplicationRuntime defaults that field to NoUserInteraction.
bindUserInteraction directly replaces that field.
main performs one explicit bind after constructing CliUi.
Permission denial before binding is a normal result, not an exception.
Session switching and Harness event subscription migration still pass.
```
