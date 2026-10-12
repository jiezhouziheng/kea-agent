# Architecture Decision Records

This directory records architectural decisions whose rationale cannot be recovered reliably from
the final code. An ADR explains why Kea deliberately chose one boundary or ownership model over
credible alternatives.

## Authority

- `accepted` ADRs constrain the current architecture.
- A changed decision gets a new ADR; the old ADR is marked `superseded by ADR-NNNN`.
- ADRs preserve why a decision was made. `docs/architecture.md` describes the resulting current
  system.
- Plans, specs, handoffs, and commit messages may provide history, but they do not override an
  Accepted ADR.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-application-runtime-as-ui-boundary.md) | accepted | ApplicationRuntime is the UI-facing application boundary |
| [0002](0002-project-owns-user-interaction.md) | accepted | Project owns the current UserInteraction |
| [0003](0003-adopt-bun-as-the-runtime-and-toolchain.md) | accepted; platform scope superseded by ADR-0006 | Bun is Kea's sole runtime and toolchain |
| [0004](0004-adopt-opentui-react-as-the-default-ui.md) | superseded by ADR-0005 | OpenTUI React becomes the default UI after parity; CLI remains permanent |
| [0005](0005-use-bracketed-functions-for-concrete-ui-lifecycles.md) | accepted; platform scope superseded by ADR-0006 | Concrete CLI and TUI each own one bracketed function lifetime |
| [0006](0006-support-windows-and-ubuntu.md) | accepted | Windows and Ubuntu are Kea's supported delivery platforms |

## Adding a decision

Add an ADR only when the decision is hard to reverse, surprising without context, and based on a
real trade-off. Use the next sequential number and record the context, decision, rejected options,
consequences, and conditions that would justify reconsidering it.
