# PoC — TiDB Cloud Starter (Tokyo) for SHIBA

**Why this exists (the gate).** SHIBA's "10x" lever (`docs/101`) is the **entity-route**:
> "for the facts linked to entity X, vector-search within that subset" — i.e. `facts JOIN fact_entities + VEC_COSINE_DISTANCE + state='active'` in **one SQL**.

This is exactly the *pre/post-filter ANN* problem that generic vector stacks struggle with. Before building the connection model (101) or the app, this PoC answers, on real Tokyo hardware:

1. Does **`EMBED_TEXT` auto-embed** (BYOK Gemini) wire up? (`gemini-embedding-2`, else `-001`)
2. Does **`FTS_MATCH_WORD`** do Japanese full-text on Tokyo? (FTS = public preview)
3. **Is the entity-route fast?** p50/p95 of the JOIN+vector+filter query — and does the vector index actually apply *after* the JOIN (EXPLAIN)?
4. Rough **RU / embed cost** feel on the free tier.

If (3) is slow or the index isn't used after the JOIN, we learn it **now** — before 101 is built on top of it.

> ⚠️ FTS and auto-embed are **preview / evolving**. The SQL here is best-effort; if a statement errors, fix it per current TiDB docs and **record the working syntax in `../../docs/LEARNINGS.md`**. That's the point of `pnpm smoke` running first.

## Prerequisites

1. A **TiDB Cloud Starter** (serverless) cluster in **AWS `ap-northeast-1` (Tokyo)** — free, no card.
2. **Embedding: nothing to set up for the PoC.** The default `EMBED_MODEL` is TiDB's **free managed** `tidbcloud_free/amazon/titan-embed-text-v2` (1024-dim, **no API key**). The production Gemini BYOK choice (`docs/91`, 1536-dim) is deferred — configure it later.
3. From the cluster's **Connect** dialog: host / port / user (`<prefix>.root`) / password / a database (create `shiba_poc`).
4. Node 22 + pnpm.

## Setup & run

```bash
cd OSS/shiba/poc/tidb
cp .env.example .env        # fill TIDB_* ; set EMBED_MODEL (try gemini-embedding-2)
pnpm install

pnpm smoke      # 1) cheap syntax check of auto-embed + vector + FTS. MUST pass first.
pnpm schema     # 2) create facts / entities / fact_entities (+ indexes), injecting EMBED_MODEL
pnpm seed       # 3) insert ~2000 JP facts (FACTS=N to change). Each insert embeds via Gemini.
pnpm bench      # 4) p50/p95/p99 per query shape + EXPLAIN of the entity-route
```

The default free model needs no key and should just work. If `pnpm smoke` fails on a feature, check the FTS parser name / index syntax against current docs (it's preview), and write what worked into `LEARNINGS.md`. (To later test Gemini quality: set `EMBED_MODEL=gemini/gemini-embedding-001` + `EMBED_DIM=1536` after configuring the BYOK key in the console.)

## Reading the results (the verdict)

- **entity-route p95** is the headline. Personal scale (a few thousand facts) should be well under a few hundred ms; recall budget is dominated by the LLM, not this query (`docs/91 §2.4`). If it's slow, inspect the EXPLAIN:
  - **Good:** the plan filters by `idx_fe_entity` then does a vector scan on the small subset (vector index / TiFlash visible).
  - **Bad:** a full vector scan ignoring the entity filter, or the optimizer can't combine JOIN-filter + vector index → 101 needs rethinking (e.g. two-step: ids by entity, then vector over that id set).
- **FTS**: confirm Japanese keywords actually match and rank (the CJK-first claim).
- **text-route vector** and **aggregate / 1-hop**: should all be single-digit→low-double-digit ms.
- **seed throughput** and the console's **RU usage** → note whether 50M RU/mo is comfortable for personal use.

## Record findings

Append a dated entry to **`../../docs/LEARNINGS.md`** (the engineering log): the working auto-embed model + FTS syntax, entity-route p50/p95, whether the vector index applied after the JOIN, and the RU/cost feel. That entry is what turns "TiDB is the bet" into "TiDB is confirmed (or not)".

## Files

| file | what |
|---|---|
| `db.ts` | TLS connection from `.env`, `ftsLiteral()` (escaped inline literal, 98 §6), `percentiles()` |
| `schema.sql` | facts / entities / fact_entities + auto-embed column + vector & FTS indexes (`__EMBED_MODEL__` injected) |
| `smoke.ts` | isolated PASS/FAIL check of the 3 TiDB features (run first) |
| `apply-schema.ts` | applies `schema.sql` statement-by-statement (clear error locating) |
| `seed.ts` | generates realistic JP facts + entity links (explicit ids) |
| `bench.ts` | per-shape p50/p95/p99 + EXPLAIN of the entity-route bet |

This is throwaway PoC code (`OSS/shiba/poc/`), not the app. Findings flow into `docs/91 §5`, `docs/101`, and `LEARNINGS.md`.
