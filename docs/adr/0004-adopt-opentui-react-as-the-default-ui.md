---
status: superseded by ADR-0005
date: 2026-08-24
implementation: complete
---

# Use OpenTUI React as the default UI while retaining CLI

ADR-0005 supersedes this decision while retaining its product mode, OpenTUI, delivery, and data
projection choices; it changes the concrete UI lifecycle boundary.

Kea will make an OpenTUI React full-screen TUI its default interactive interface after it reaches
feature parity with the current readline CLI. The CLI remains a permanent first-class mode selected
with `--ui cli`. UI selection happens only at process startup, and TUI integration does not change
the ApplicationRuntime, UserInteraction, or HarnessEvent boundaries.

## Context

Kea currently has one concrete readline `CliUi`. `main.ts` constructs an `ApplicationRuntime`,
constructs the CLI, binds its `UserInteraction`, runs the UI, and closes UI resources before closing
the Runtime. ADR-0001 makes ApplicationRuntime the UI-facing owner of the current AgentHarness and
subscription migration. ADR-0002 makes Project the owner of the current UserInteraction. ADR-0003
adopts Bun as the sole runtime and explicitly defers production OpenTUI architecture.

The desired product is a full-screen terminal application with a scrollable transcript, streaming
assistant and Tool state, a fixed composer or interaction panel, and a footer. It must retain the
existing CLI for scripts, constrained terminals, diagnosis, and user preference. Kea has only two
local in-process UIs and no UI registry, remote UI transport, multiple windows, or runtime UI
switching requirement.

HarnessEvent already publishes ordered text, thinking, and Tool deltas and provides complete
messages at `turn-end`. ApplicationRuntime already keeps a UI subscription attached across Session
replacement. A TUI therefore needs a local render projection and explicit snapshot refresh after
its own Session/model workflows; it does not need a new core event protocol.

## Decision

### Product modes

- The final default for `kea` is `--ui tui` behavior.
- `--ui tui` and `--ui cli` are the only accepted explicit values.
- The UI mode is parsed by the existing `parseArgs()` and is not stored in Config, Project, Session,
  or ApplicationRuntime.
- There is no in-process UI switch.
- The default changes to TUI only after TUI behavior and delivery verification reach the current
  CLI parity gate.
- The CLI is retained permanently and remains covered by its existing tests.

### OpenTUI binding and delivery

- The TUI uses `@opentui/core`, `@opentui/react`, and React 19.2-compatible releases.
- It uses OpenTUI alternate-screen mode as a full-screen application.
- Bun 1.3.7 remains the sole runtime/toolchain and TypeScript continues to emit production
  JavaScript with `tsc -> dist`; this decision does not introduce bundling or a Node fallback.
- The TUI branch is dynamically imported. `--ui cli` must not load OpenTUI native dependencies.
- A non-interactive terminal selected for TUI fails before ApplicationRuntime construction and
  instructs the user to choose `--ui cli`.
- TUI initialization failure is reported after cleanup and never silently falls back to CLI.

### UI boundary

- The concrete TUI entry is `runTui(runtime, options): Promise<void>`.
- `runTui()` owns one bracketed renderer/React lifetime and settles only after terminal cleanup.
- If shutdown interrupts an active Prompt, `runTui()` aborts it and waits for that Prompt Promise to
  settle before returning, so ApplicationRuntime is never closed against a still-running Harness.
- Because Kea removes SIGINT from the renderer's exit signals to implement its Ctrl+C behavior,
  `runTui()` owns and cleans up the corresponding process-level SIGINT listener.
- Kea does not add `ApplicationUi`, `TuiUi`, a lifecycle handle, UI factory, registry, manager, or
  controller.
- `main` selects the concrete UI and retains ownership of ApplicationRuntime closure.
- TUI implements and binds `TuiInteractions` through ApplicationRuntime. Project remains the
  Interaction owner and Runtime close restores NoUserInteraction.
- CLI remains in its existing concrete class form; asymmetry is accepted because the two UIs have
  different lifecycle mechanics.

### Data and interaction

- HarnessEvent remains the observation protocol. The TUI synchronously projects deltas into local
  React state and uses `turn-end.message` plus `toolResults` as the final authority.
- The TUI explicitly refreshes the current Harness/Session snapshot after successful new/switch
  operations; Runtime subscription migration is not treated as a Session-changed event.
- TUI state is a render projection, not a second Session or application state owner.
- Session/model command selectors and reverse UserInteraction requests may share a visual bottom
  panel but not the UserInteraction API direction.
- TuiInteractions permits at most one pending request, propagates Run abort, and fails closed on
  invalid concurrency or adapter failure.
- Errors are redacted through a function injected by `main` before entering TUI state.

The detailed component, reducer, layout, lifecycle, testing, and staged rollout design is recorded
in `docs/superpowers/specs/2026-08-24-opentui-tui-design.md`.

## Considered Options

### Replace the CLI with TUI

This removes maintenance of the readline UI, but also removes the simplest fallback for scripts,
non-interactive streams, native renderer diagnosis, and terminals unsupported by OpenTUI. The user
requires CLI to remain permanently, so this option is rejected.

### Add a shared ApplicationUi interface

A common interface would make the two branches look symmetric, but Kea has no registry, dynamic UI
family, test double boundary, or external consumer requiring polymorphism. `main` can directly call
two concrete entry shapes. The interface would name no new responsibility, so it is rejected.

### Use a TuiUi class or createTui lifecycle handle

OpenTUI renderer creation is asynchronous and the full-screen app has one valid lifetime. A class
or handle exposes unnecessary ordering states such as closing before run, running twice, or failing
to close. A bracketed `runTui()` function expresses the actual operation, so public lifecycle
objects are rejected.

### Refactor CLI into runCli for symmetry

This changes tested readline code without improving its behavior or the TUI boundary. Visual
symmetry in `main` is not an architectural responsibility, so the refactor is rejected.

### Use the Solid binding

OpenTUI Solid is capable and used by other products. Kea chooses React because the project prefers
its ecosystem and familiarity, and the required TUI behavior does not depend on Solid-specific
capabilities.

### Change HarnessEvent to cumulative message updates

This would expand the core protocol and repeatedly move a growing message for a local rendering
concern. Existing deltas plus the final turn payload already provide streaming and authoritative
completion, so the change is rejected.

### Use main-screen or inline rendering

The target has a scrollable transcript, fixed composer/interaction slot, and footer. Alternate
screen directly models that application; the retained CLI already covers scrollback-native linear
terminal interaction.

### Fall back to CLI when TUI fails

Automatic fallback would hide native installation, terminal, and initialization failures and make
the actual selected UI ambiguous. Selection must remain explicit, so this option is rejected.

## Consequences

- The root package gains OpenTUI native optional dependencies, React, TSX compiler settings, and a
  larger cross-platform lockfile.
- Windows, Ubuntu, and macOS install/build/global-package verification become part of the TUI
  acceptance gate.
- TUI rendering state is intentionally separate from persisted Session state and must reconcile
  missing user/Session-change events explicitly.
- `runTui()` hides lifecycle ordering and guarantees terminal restoration before it settles.
- Fatal TUI lifecycle errors are caught and redacted in `main` after terminal cleanup while Config
  is still available; they do not fall through to the unredacted top-level safety net.
- CLI and TUI share ApplicationRuntime, UserInteraction, command grammar, and behavior requirements,
  but not rendering code or a common UI abstraction.
- Full-screen TUI cannot run without an interactive terminal; users must explicitly choose CLI for
  non-interactive use.
- The default mode cannot switch until parity and cleanup tests pass, so implementation is staged
  without temporarily degrading the current production CLI.

## Reconsider When

Reconsider the missing common UI boundary only if Kea gains a third UI, runtime-loaded UI plugins,
a remote/IPC host, multiple simultaneous windows, or an external consumer that genuinely requires
polymorphic lifecycle control. Reconsider OpenTUI if its native dependencies cannot pass Kea's
supported Bun and three-platform delivery matrix. Either change requires a superseding ADR rather
than an undocumented fallback.
