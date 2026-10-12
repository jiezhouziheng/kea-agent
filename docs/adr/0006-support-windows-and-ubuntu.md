---
status: accepted
date: 2026-08-25
supersedes:
  - ADR-0003 platform coverage
  - ADR-0005 inherited platform coverage
---

# Support Windows and Ubuntu

## Context

Kea's Bun migration and OpenTUI adoption originally established Windows, Ubuntu, and macOS as one
delivery matrix. The macOS OpenTUI character-frame suite now terminates inside the native renderer
with `SIGTRAP`, after its application assertions have passed. Maintaining that platform would
require platform-specific investigation and ongoing release capacity that the project does not
intend to provide.

The supported audience is Windows and Ubuntu. Keeping a failing macOS job, skipping only selected
tests, or marking the job as allowed to fail would imply a support promise that Kea does not make.

## Decision

- Kea supports Windows and Ubuntu.
- GitHub CI runs the complete frozen-install, typecheck, source-test, build, dist, and isolated
  global-package graph on `windows-latest` and `ubuntu-latest` only.
- macOS is not part of the supported or release-gating matrix. macOS-specific failures do not block
  Kea releases.
- The package may continue to receive transitive Darwin native artifacts from OpenTUI, but their
  presence is not a compatibility guarantee.
- All Bun/toolchain decisions in ADR-0003 and all concrete UI lifecycle decisions in ADR-0005 remain
  accepted; this ADR supersedes only their platform-coverage clauses.

## Rejected Alternatives

### Skip only the OpenTUI tests on macOS

Other build or delivery stages could still fail, while a green partial job would suggest that macOS
is supported. Selective skips would hide the actual platform boundary.

### Keep macOS as an allowed-to-fail job

This would continue spending CI time without providing a release guarantee and leave contributors
uncertain whether failures require action.

## Consequences

- Windows and Ubuntu remain observable release gates for the complete Bun delivery graph.
- macOS users receive no tested compatibility or maintenance commitment.
- The CI matrix is smaller and no longer blocked by OpenTUI's macOS native renderer behavior.

## Reconsider When

Reconsider macOS support when the project has a concrete macOS user requirement, a maintainer able
to own that platform, and a stable OpenTUI/Bun test and delivery path. Restoring support requires a
new superseding ADR and a release-gating macOS CI job.
