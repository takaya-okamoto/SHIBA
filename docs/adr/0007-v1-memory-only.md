# 0007 — v1 is memory-only (no outward actions) to avoid the lethal trifecta

**Status:** Accepted

## Context
The dangerous combination ("lethal trifecta") is **private data × untrusted input × the ability to
act**. An agent that can read your private memory, ingest attacker-influenced text, *and* take
outward actions can be turned against you ("an email tells the agent to act as you"). Adding actions
safely needs human-in-the-loop approval with real values, capability scoping, provenance taint, etc.

## Decision
**v1 implements memory only** — no email replies, no calendar writes, no external ingestion (Gmail /
web). This removes the third leg structurally: those attacks cannot occur because the agent cannot
act. The action-security design is kept separate for v2+ (research `docs/100`). The one untrusted
path that *does* remain in v1 — text the owner pastes/forwards/OCRs — is contained by `source_trust`
(facts from it land `untrusted`, never auto-promote, never trigger future actions).

## Consequences
- v1 can ship with a small, auditable threat model (see `SECURITY.md`).
- `source_trust` is wired now so the v2+ action invariants ("untrusted never triggers an action") are
  already in place when actions arrive.
- Capabilities users might expect (send a reply, add an event) are explicitly deferred, not forgotten.
