# Kea Agent Instructions

## Canonical project knowledge

Before architecture design or refactoring, read:

- `CONTEXT.md` for Kea's canonical language.
- `docs/architecture.md` for the current system shape.
- `docs/adr/README.md` and the Accepted ADRs related to the modules being changed.

Use `docs/architecture.md` plus Accepted ADRs as the current architectural authority. Files under
`docs/superpowers/plans/` and `docs/superpowers/specs/` preserve design and implementation history;
they are not authoritative when they conflict with the current architecture or a later ADR.

If code, tests, architecture documentation, and ADRs disagree, stop and surface the drift. Do not
silently choose one source or rewrite history to make the conflict disappear.

## Architecture decision protocol

Record an ADR when a decision is hard to reverse, surprising without context, and the result of a
real trade-off.

- Capture the context, chosen decision, important rejected alternatives, and non-obvious
  consequences.
- Do not leave an accepted architectural decision only in a chat, plan, handoff, or commit message.
- Do not silently violate or rewrite an Accepted ADR.
- When a decision changes, create a new ADR and mark the previous ADR as superseded.
- Keep `docs/adr/README.md` and `docs/architecture.md` aligned with accepted decisions.

## Language

Use the terms defined in `CONTEXT.md`. Before introducing a new manager, runtime, service,
controller, session, or context abstraction, check whether an existing Kea term already owns that
responsibility. New names must represent a genuinely new responsibility rather than a synonym for
an existing concept.
