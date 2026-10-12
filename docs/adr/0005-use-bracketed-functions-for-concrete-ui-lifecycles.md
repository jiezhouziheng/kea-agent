---
status: accepted
date: 2026-08-25
implementation: complete
supersedes: ADR-0004
platform-coverage: superseded by ADR-0006
---

# Use bracketed functions for concrete UI lifecycles

## Context

ADR-0004 selected `runTui()` but retained the readline UI as `CliUi`. Both concrete UIs are
single-run operations, Kea does not support process-local UI switching, and no consumer needs a
public lifecycle object. Each concrete UI also owns the knowledge required to construct and bind
its `UserInteraction`.

Keeping `CliUi` made `main` coordinate construction, Interaction binding, `run()`, and `close()`
even though only one call order was valid. That control surface did not provide a product ability.

## Decision

- The public concrete entries are `runCli(runtime, options): Promise<void>` and
  `runTui(runtime, options): Promise<void>`.
- Each function creates and binds its concrete `UserInteraction` and cleans up every UI resource
  it creates before returning.
- Neither function closes `ApplicationRuntime`; `main` retains that outer ownership.
- Both concrete UI entries are dynamically imported only after startup selects their mode.
- Kea does not add `ApplicationUi`, a lifecycle handle, UI factory, registry, manager, or
  controller.
- ADR-0004's default TUI, permanent CLI, OpenTUI React, data projection, and failure decisions
  remain in force through this superseding ADR. ADR-0006 supersedes only its inherited
  three-platform delivery requirement.

## Rejected Alternatives

### Keep `CliUi`

It exposes construction, binding, run, and close as caller choreography even though Kea has only
one legal CLI lifetime.

### Return a lifecycle handle

`createCli()` returning interactions, run, and close preserves the same unnecessary control surface
without adding a consumer that needs it.

### Bind in `main`

This makes the composition root know how each concrete UI constructs its reverse Interaction port.

### Add `ApplicationUi`

Two statically selected local UIs still do not require polymorphism, registration, or external
lifecycle control.

## Consequences

- `main` selects concrete functions and no longer binds or closes a concrete UI.
- UI functions depend on `ApplicationRuntime.bindUserInteraction()`, while core and coding-agent
  remain independent of concrete UI modules.
- Tests drive each complete UI operation and observe Interaction binding through the Project port.
- Callers cannot run a concrete UI twice or omit its cleanup through a public lifecycle handle.

## Reconsider When

Reconsider a shared lifecycle boundary only if Kea gains a third UI, runtime-loaded UI plugins,
multiple simultaneous windows, a remote/IPC host, or an external consumer that needs lifecycle
control beyond running one complete UI operation.
