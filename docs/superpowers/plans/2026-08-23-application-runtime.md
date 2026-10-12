# Application Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增只管理当前 Harness 激活与订阅迁移的 `ApplicationRuntime`，并让 CLI 与组合根使用这一生命周期边界。

**Architecture:** Project 创建或恢复候选 Harness，UI 在不改变当前状态的情况下完成候选模型准备，`ApplicationRuntime.activate(candidate)` 最后提交当前 Harness 并迁移现有 `HarnessEvent` 监听器。UI 通过 `runtime.current` 和 `runtime.project` 直接使用已有能力，Runtime 不提供代理方法。

**Tech Stack:** TypeScript 7、Node.js 24、Node 内置测试运行器、现有 Project/AgentHarness/HarnessEvent API。

**Spec:** `docs/superpowers/specs/2026-08-23-application-runtime-design.md`

## Global Constraints

- 只支持一个 Project 和一个前台 AgentHarness。
- Project 负责创建和恢复候选 Harness。
- UI 负责候选模型准备和取消交互。
- Runtime 只负责 `activate`、当前引用和长期订阅迁移。
- 当前 Harness 运行时拒绝激活，不自动 abort。
- 不增加事件类型、EventBus、代理方法、npm 依赖或 TUI。
- 不执行 git 操作，除非用户明确要求。

## File Map

- Create: `src/coding-agent/application-runtime.ts`
- Create: `tests/coding-agent/application-runtime.test.ts`
- Modify: `src/coding-agent/index.ts`
- Modify: `src/ui/cli/cli-ui.ts`
- Modify: `tests/ui/cli/cli-ui.test.ts`
- Modify: `src/main.ts`
- Modify: `tests/ui/cli/full-composition.test.ts`
- Modify: `docs/superpowers/specs/2026-08-23-application-runtime-design.md`
- Modify: `docs/superpowers/plans/2026-08-23-application-runtime.md`

---

### Task 1: Define current Harness activation

**Interfaces:**

- Consumes: `AgentHarness.isRunning` 和 `AgentHarness.subscribe(listener)`。
- Produces: `ApplicationRuntime.project`、`current`、`activate(candidate)`、`subscribe(listener)`、`close()`。

- [x] Write failing tests for current replacement, subscription migration, running rejection and close behavior.
- [x] Confirm RED because `ApplicationRuntime` and later `activate()` are missing.
- [x] Implement Runtime with no Session creation or Project/Harness proxy methods.
- [x] Export `ApplicationRuntime` from `src/coding-agent/index.ts`.
- [x] Confirm focused Runtime tests pass.

The public implementation shape is:

```ts
class ApplicationRuntime {
  readonly project: Project;
  get current(): AgentHarness;
  activate(candidate: AgentHarness): void;
  subscribe(listener: Parameters<AgentHarness["subscribe"]>[0]): () => void;
  close(): void;
}
```

---

### Task 2: Migrate CLI through two-phase activation

**Interfaces:**

- Consumes: Task 1 Runtime and existing Project candidate creation/model methods.
- Produces: `CliUi.run(runtime: ApplicationRuntime): Promise<void>`。

- [x] Change CLI tests to construct a real ApplicationRuntime around existing fake Project/Harness values.
- [x] Add regression coverage proving a prompt after `/new` reaches the newly activated Harness.
- [x] Confirm RED against the old two-argument `CliUi.run(project, harness)` contract.
- [x] Replace writable Project/current Harness fields with one Runtime reference.
- [x] Route prompt and SIGINT abort through `runtime.current`.
- [x] Route Session/model queries and candidate creation through `runtime.project`.
- [x] Preserve model preparation before calling `runtime.activate(candidate)`.
- [x] Register the existing renderer callback once through `runtime.subscribe()`.
- [x] Preserve UI-owned unsubscribe behavior in `ui.close()`.
- [x] Confirm initial model-repair cancellation performs no subscription and never enters the prompt loop.

The activation path is:

```ts
const candidate = await runtime.project.createHarnessFromSession(sessionId);
if (!await ensureConfiguredModel(candidate)) return;
runtime.activate(candidate);
renderer.renderSession(candidate);
```

---

### Task 3: Wire the composition root

**Interfaces:**

- Consumes: `selectInitialHarness`, `ApplicationRuntime`, and `CliUi.run(runtime)`。
- Produces: one application Runtime owned and closed by `main`。

- [x] Rename the existing model execution variable to `modelRuntime`.
- [x] Create `applicationRuntime` from Project and initial Harness.
- [x] Call `ui.run(applicationRuntime)`.
- [x] Close UI and ApplicationRuntime in the existing `finally` block.
- [x] Update the full-composition test to use the new Runtime entry point.

The composition shape is:

```ts
const modelRuntime = createModelRuntime(...);
const project = await openOrCreateProject({ runtime: modelRuntime, ... });
const initial = await selectInitialHarness(project, continueFlag);
const applicationRuntime = new ApplicationRuntime(project, initial);

try {
  await ui.run(applicationRuntime);
} finally {
  ui.close();
  applicationRuntime.close();
}
```

---

### Task 4: Verification

- [x] Run the focused build and Runtime/CLI/composition/main tests.
- [x] Confirm all 24 focused tests pass.
- [x] Run the complete project test suite with `npm test`.
- [x] Confirm the complete suite passes without regressions.

Expected final invariants:

- `CliUi` has no writable current Harness.
- Project creates candidates but does not own current selection.
- Runtime activates prepared candidates and migrates the same HarnessEvent listeners.
- Failed candidate preparation leaves the old Harness and subscription unchanged.
- No ApplicationEvent, RuntimeEvent, second EventBus or proxy methods exist.
