# 0001 — TiDB Cloud Starter as the single derived index

**Status:** Accepted

## Context
Recall needs vector similarity *and* keyword/full-text search (Japanese first-class), plus somewhere
to keep per-fact state (active/superseded) and entity links. Running a separate vector DB + search
engine + embedding service is operational overhead for a personal, self-hosted agent.

## Decision
Use **TiDB Cloud Starter** as the one derived index: MySQL-compatible, with `VECTOR` columns +
`VEC_COSINE_DISTANCE`, full-text indexes (MULTILINGUAL parser), and **in-DB auto-embedding**
(`EMBED_TEXT` generated columns) so the app doesn't run an embedding service. The free Starter tier
(Tokyo) covers personal volume. Validated in `poc/tidb` (auto-embed + FTS + scale-safe entity-route).

## Consequences
- One dependency instead of three; one query plan to reason about.
- Embedding model/dim is baked into the generated column at migrate time → an index-identity gate
  (`meta` table, ADR-0003 invariant) refuses to start on a mismatch.
- FTS is a preview feature → a LIKE fallback (`config.search.ftsMode`) is kept as a retreat.
- The index is **disposable**: `reindex --all` rebuilds it from Markdown (ADR-0003).
