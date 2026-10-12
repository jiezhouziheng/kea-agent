---
status: accepted
date: 2026-08-24
platform-coverage: superseded by ADR-0006
---

# Adopt Bun as the runtime and toolchain

Kea will use Bun 1.3.7 as its sole package manager, script runner, test runner, and application
runtime. TypeScript remains the production compiler, and Kea continues to ship JavaScript in
`dist/` for a globally installable `kea` command.

## Context

Kea currently uses npm, Node.js 24, TypeScript, and `node:test`. Kea has selected OpenTUI for a later
TUI design, and establishing Bun first avoids making that work carry two runtime contracts, two test
semantics, and ambiguous installation and CI paths. This ADR does not decide the production TUI
architecture or add OpenTUI to the application.

This is a delivery architecture decision rather than a change to the application domain. Session,
AgentHarness, Project, ApplicationRuntime, and UserInteraction ownership do not depend on the
JavaScript runtime. Kea also has a substantial behavior suite, so the runtime transition must keep
the existing `tsc -> dist` boundary and migrate one concern at a time.

## Decision

Bun 1.3.7 is the only supported runtime and package tool for the root Kea package.

- `packageManager` and CI pin Bun 1.3.7.
- The root package commits `bun.lock` as its only lockfile and uses frozen Bun installs.
- Bun runs package scripts, production JavaScript, tests, and the global `kea` command.
- `tsc` remains the type checker and production compiler. A build-specific configuration emits only
  `src/` into `dist/`; scripts explicitly force the TypeScript CLI to run under Bun, and tests
  execute directly from TypeScript.
- Tests use the `bun:test` runner and its native registration, parameterization, and conditional-skip
  APIs. Test discovery is rooted at `tests/`. Existing strict assertions may continue to use
  `node:assert/strict` when a cosmetic rewrite would add migration risk.
- The `kea` bin continues to point to a JavaScript artifact in `dist/` and uses a Bun shebang.
- The current private package is packed to a tarball before local global installation. A registry
  package may later be installed directly with `bun install -g kea-agent`.
- CI covers Windows, Ubuntu, and macOS. This platform-coverage clause is superseded by ADR-0006.
- Compatible `node:*` module specifiers may remain. They name Bun's compatibility APIs and do not
  constitute Node runtime support.
- No package script, CI job, documented workflow, or executable entrypoint provides a permanent
  Node or npm fallback.
- OpenTUI does not enter the production package in this migration; the completed feasibility spike
  is removed.

## Considered Options

### Permanently support both Node and Bun

This would preserve a familiar fallback, but it doubles the runtime compatibility surface and makes
the future OpenTUI application carry a Node promise it does not need.

### Use Bun only as the package manager

Keeping Node as the application and test runtime minimizes the immediate diff, but it does not
establish the runtime OpenTUI needs and leaves Kea with a split toolchain.

### Replace TypeScript compilation with `bun build`

A Bun bundle may become useful with a TSX TUI, but deciding bundling, externals, dynamic imports, and
native dependency handling now would mix a second architectural change into the runtime migration.

### Publish TypeScript source as the executable entrypoint

Bun can execute TypeScript directly, but making the global bin depend on the repository's source
layout weakens the current production artifact boundary.

## Consequences

- Contributors and users building or running Kea must install the pinned Bun toolchain.
- Package installation, tests, CLI behavior, and SDK integrations must be verified under
  JavaScriptCore rather than V8.
- The test suite moves from `node:test` to `bun:test`; runner-specific subtests and conditional skips
  require explicit conversion.
- Production code can retain well-supported `node:*` APIs, avoiding unrelated rewrites.
- `dist/` becomes production-only because Bun executes TypeScript tests directly.
- Local global installation uses a tarball because Bun 1.3.7 does not reliably install or globally
  link the current directory on Windows.
- Three-platform CI costs more runner time but makes the documented platform support observable.
  This consequence is superseded by ADR-0006.
- OpenTUI can be designed on the chosen runtime later without reopening the runtime decision.
- A future single-file or standalone distribution requires a separate decision about `bun build` or
  `bun --compile`.

## Reconsider When

Reconsider this decision if Bun cannot correctly support a required Kea capability or dependency,
or if Kea must ship a runtime-independent executable to users who cannot install Bun. A changed
decision requires a superseding ADR rather than an undocumented Node fallback.
