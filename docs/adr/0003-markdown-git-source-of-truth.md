# 0003 — Markdown + git is the source of truth; the DB is rebuildable

**Status:** Accepted

## Context
Two failure modes haunt memory agents: vendor lock-in (your memory trapped in a proprietary DB) and
silent corruption you can't inspect or undo. We want memory the owner can read, edit, diff, back up,
and export forever.

## Decision
**The source of truth is human-readable Markdown under git** (`data/memory/`): `MEMORY.md` (resident),
`memory/YYYY-MM-DD.md` (daily notes with a ` ```facts ` fence), `profile.md`. TiDB is a **derived
index** rebuilt by `reindex --all`. The invariant: *drop TiDB entirely and `reindex` restores
everything.* Offsite backup is a private GitHub repo (git push).

This deliberately differs from DB-as-truth designs (e.g. mem9): truth is files, not rows.

## Consequences
- Edits are just text; supersede is a strikethrough (`~~...~~`) the reindex re-derives.
- `source_trust`, entity links, and state are all re-derivable from the fence grammar.
- The DB can be wiped/migrated/re-embedded freely; only `data/memory/` is precious.
- Worked example: [`../data-storage.md`](../data-storage.md).
