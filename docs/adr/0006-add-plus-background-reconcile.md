# 0006 — Inline ADD + background reconcile, not an inline self-correction loop

**Status:** Accepted

## Context
A survey of 8 memory OSS projects found that **inline LLM self-correction loops were uniformly
avoided or removed** (cost, latency, instability), while several projects shipped a "supersession"
classifier that ended up **dead code** (gbrain) — so memory just accumulated contradictory ADD-only
facts.

## Decision
Keep the **turn fast and ADD-biased**, and do the careful work as a **bounded reconcile step** at the
session boundary, not an inline self-correcting loop. Stage 1 extracts atomic facts; stage 2
`reconcile` gathers the related existing facts (by entity overlap), asks the LLM once for
ADD/UPDATE/DELETE/NOOP with integer-masked ids, and applies non-destructive supersede (strike the old
line, ADR-0003). It is **fail-open to ADD-only** so a hiccup never loses a freshly-learned fact, and
resident facts (`MEMORY.md` / `profile.md`) are pinned against auto-supersede.

## Consequences
- Avoids the dead-supersession trap: UPDATE/DELETE actually fire and are visible as strikethrough.
- One extra LLM call only when there *are* related facts (the common case short-circuits).
- Promotion to resident memory is a separate, deliberate step (dreaming / `/remember`), not inline.
