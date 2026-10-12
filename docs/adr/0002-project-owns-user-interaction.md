---
status: accepted
date: 2026-08-24
related-commit: fbe8481
---

# Let Project own the current UserInteraction

Kea constructs Project and the initial AgentHarness before a concrete UI exists, while permission
Hooks inside every Harness may later need user input. Project therefore owns a replaceable
UserInteraction with a safe NoUserInteraction default, and its private Hook assembly reads the
current value when a permission decision is executed.

## Context

UserInteraction is the UI-independent reverse boundary used by internal policy code to ask for a
selection, confirmation, or text input. It is not an API through which UI controls the application.

The initial Harness must be usable before CLI or TUI binds an interaction implementation. Binding a
UI later must also affect already-created Harnesses, and Session replacement must not require
ApplicationRuntime to understand or mutate Harness Hook internals.

The permission behavior needs project-scoped state: the canonical project directory, remembered
approvals, and the currently bound UserInteraction. This makes Project the lifecycle owner and the
natural place to assemble the permission Hook.

## Decision

Project owns the current UserInteraction and initializes it with NoUserInteraction.

- `ApplicationRuntime.bindUserInteraction()` validates the application lifecycle and delegates the
  binding to Project; Runtime does not store the Interaction.
- Closing ApplicationRuntime restores Project to a new NoUserInteraction.
- Project privately creates each HarnessHooks instance and registers the complete permission
  `beforeTool` callback in one `createHooks()` method.
- The callback reads `this.interaction` when invoked. It does not capture the Interaction that was
  current when the Harness was constructed.
- HarnessHooks remains a generic callback registry and invoker. It does not know UserInteraction,
  permission policy, Project, or UI.
- Permission decision functions remain pure policy functions whose dependencies are supplied by
  the Project-owned callback.
- UI implements UserInteraction and binds it after ApplicationRuntime and the UI have both been
  created.
- ApplicationRuntime does not expose `select()`, `confirm()`, or `input()`. Those operations point
  from internal policy toward UI, not from UI toward the application.

## Considered Options

### Throw when no UserInteraction is bound

This makes construction order observable throughout the kernel and leaves headless operation
without a safe policy. NoUserInteraction instead permits operations that need no approval and
denies requests that require a user decision.

### Let ApplicationRuntime own and migrate UserInteraction

Runtime would have to write the Interaction into every current or candidate Harness. The attempted
design required a special CodingAgentHooks subtype, an external binding function, and runtime type
checks, coupling the application controller to private Harness assembly.

### Put UserInteraction in HookContext

HookContext describes one Harness run and Tool invocation. UserInteraction has a longer application
and Project lifecycle, so passing it through AgentHarness, the agent loop, ToolRegistry, and every
Hook invocation would turn call context into a dependency container.

### Pass UserInteraction to createHarness()

This exposes a construction dependency on every Harness creation path and captures whichever UI was
bound at that moment. Later replacement would still require rebuilding or mutating existing
Harnesses.

### Expose Project.getInteraction()

This moves lookup plumbing into every consumer and encourages Project to grow one getter for each
future dynamic dependency. The permission callback can access the state directly at the Project
composition boundary without exposing it publicly.

### Use an exported createHooks factory with a Project callback

Passing a callback can make late binding work, but it splits one complete permission behavior
between Project and the factory solely to preserve factory symmetry with ToolRegistry. ToolRegistry
uses stable explicit construction values; permission Hooks depend on mutable Project lifecycle
state, so their assembly need not have the same shape.

### Store binding state in InteractionSlot or a Hooks subclass

Both approaches introduce another state holder whose only purpose is forwarding to the real
Interaction. They also make generic HarnessHooks carry a coding-agent UI concern.

## Consequences

- Project deliberately knows the UI-independent UserInteraction port, but not CLI, TUI, readline,
  rendering, or concrete UI classes.
- Existing and future Harnesses created by the Project observe the latest binding without migration.
- ApplicationRuntime preserves a clean UI-facing control role and does not understand permissions
  or Hook construction.
- The private Project `createHooks()` and the public ToolRegistry factory are intentionally
  asymmetric because their dependencies have different lifecycles.
- One Project currently has one active Interaction policy. Concurrent Harnesses requiring distinct
  UIs or permission prompts would invalidate this assumption and require a superseding ADR.
