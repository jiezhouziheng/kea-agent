---
status: accepted
date: 2026-08-24
related-commit: fbe8481
---

# Use ApplicationRuntime as the UI-facing application boundary

Kea needs one application-level owner for the currently selected AgentHarness and for UI
subscriptions that must survive Session replacement. We use ApplicationRuntime for that state while
Project remains the owner of project-scoped Sessions and Harness construction, avoiding both UI
orchestration duplication and a speculative AgentClient or service layer.

## Context

Project can create a new Harness or restore one from a Session, but that does not make the Project
itself the running application. CLI and future UI implementations need to operate on one current
Harness, replace it safely, and continue receiving events after replacement.

Letting each UI coordinate Project and AgentHarness directly would duplicate Session switching and
subscription migration. Putting the current selection into Project would mix project-scoped domain
state with the state of one running application. The application initially supports one Project and
one current Harness, but the ownership boundary must not prevent a future application shell from
coordinating more than one Project.

## Decision

ApplicationRuntime owns the current AgentHarness for one running Kea application.

- `newSession()` and `switchSession()` ask Project to prepare a candidate Harness and replace the
  current Harness only after preparation succeeds.
- A failed replacement preserves the previous current Harness and its subscriptions.
- `subscribe()` is a stable UI-facing subscription whose underlying Harness subscription follows a
  successful replacement.
- Runtime rejects replacement while the current Harness is running because Kea has no concurrent
  Harness execution model.
- Runtime exposes `project` and `current`; it does not mirror every Project or AgentHarness method.
  UI code may list Sessions and models through Project and prompt through the current Harness.
- `createApplicationRuntime()` is the production composition root. It opens the Project, creates or
  restores the initial Harness, and returns ApplicationRuntime.
- UI implementations depend on ApplicationRuntime. Main performs startup composition but does not
  expose Project and Harness construction as the UI's application boundary.
- ApplicationRuntime has no separate `activate()` phase. Model repair is a UI workflow performed
  after a successful Session switch, not a reason to split Runtime replacement into prepare and
  activate APIs.

## Considered Options

### Let Project own the current Harness

Project already owns multiple Sessions and creates Harnesses, but "which Harness this application
window is currently using" is application state. Adding it to Project would combine two lifecycles
and make future cross-Project application navigation harder to express.

### Let each UI use Project and AgentHarness directly

This keeps ApplicationRuntime out of the model, but CLI and TUI would each implement replacement,
failure rollback, and event resubscription. Main would also expose the same construction chain that
the application factory is meant to hide.

### Add an explicit activate(candidate) operation

This was introduced to accommodate CLI model repair for restored Sessions. It made a UI-specific
preparation concern redefine the application controller and created an intermediate candidate
lifecycle Kea does not otherwise need.

### Hide Project and AgentHarness behind mirrored Runtime methods

Methods such as `listSessions()`, `prompt()`, and model operations would merely duplicate existing
Project and AgentHarness APIs. ApplicationRuntime is an application state boundary, not a facade
that must conceal every lower-level object.

### Introduce AgentClient or an application service layer

Kea has no remote transport, process boundary, multiple client implementations, or application
service family requiring this indirection. Adding one now would name a hypothetical responsibility
rather than solve an existing problem.

## Consequences

- CLI and TUI can share replacement and subscription semantics without sharing rendering code.
- Project remains useful as the project-scoped owner even though ApplicationRuntime controls the
  current application selection.
- ApplicationRuntime is intentionally stateful and singular for one application run.
- Supporting multiple simultaneously active Harnesses, windows, or Projects will require revisiting
  the singular `current` contract rather than silently stretching it.
- A remote or IPC UI boundary may later justify AgentClient, but it is not part of the local
  in-process architecture.
