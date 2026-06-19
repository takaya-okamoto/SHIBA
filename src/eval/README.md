# `src/eval/` — search-regression harness (layer 1)

Locks in recall behavior so a refactor of the fusion pipeline can't silently regress it. This is
**layer 1** of the 3-layer eval design (`docs/95 B-1`): unit search-regression, run on every CI pass.
Layers 2 (golden conversations + LLM judge) and 3 (operational feedback) are separate and deferred.

## Run it

```bash
pnpm eval     # CLI report, exits non-zero on any failure
pnpm test     # the same fixtures run as vitest cases (src/eval/regression.test.ts)
```

No database is needed — fixtures feed the **real `search()`** through offline providers, so the
fusion logic (RRF → demote-untrusted → recency-decay → autocut) is exercised exactly as in
production, just with the route I/O stubbed.

## Two fixture modes

A suite YAML lives in `fixtures/*.yaml` and is auto-discovered. Pick a mode per file:

### `mode: routes` — fusion regression (`fixtures/fusion.yaml`)
Each case declares what every route returns; the harness asserts the fused/cut result. This is the
faithful place to guard the fusion math — the openclaw "keyword-only hit dropped" bug lived here.

```yaml
suite: fusion
mode: routes
cases:
  - name: keyword-only-hit-survives-fusion
    query: "..."
    routes:
      vector: [ { id: v1, claim: "..." } ]
      fts:    [ { id: k1, claim: "..." } ]   # also: chunkVector / chunkFts / entity
    contains: ["k1"]        # k1 must not be dropped
    count: { min: 2 }
```

### `mode: corpus` — keyword/LIKE recall (`fixtures/like-recall.yaml`)
A shared corpus; keyword routes do real substring matching (the LIKE fallback the doc says CI must
cover). Vector routes return `[]` — no offline embeddings — so corpus mode isolates the keyword path,
including CJK substring recall (kana/kanji/mixed) which needs no tokenizer.

```yaml
suite: like-recall
mode: corpus
corpus:
  facts:  [ { id: f-gomi, claim: "毎週火曜は燃えるゴミの日", kind: commitment } ]
  chunks: [ { id: ch1, content: "京都旅行のmemo" } ]      # surfaces as id `c:ch1`
cases:
  - name: kanji-substring-recall
    query: "ゴミ"
    contains: ["f-gomi"]
```

## Assertions (any subset; all must hold)
`topK` (exact ordered) · `first` · `contains` · `excludes` · `order` (subsequence) ·
`count: {min,max}`. Pin `now: "YYYY-MM-DD"` on a case to make recency-decay deterministic.

## Adding a case
Drop a new entry in an existing suite (or a new `*.yaml`). No code change — `regression.test.ts`
discovers it. Validate with `pnpm eval`. Keep heuristics lean: a fixture should pin a *behavior*, not
overfit to one phrasing (the mem9 1,900-line regex over-fit is the cautionary tale, `docs/95 B-1`).

## Fidelity boundary (important)
The offline LIKE proxy is case-sensitive substring — faithful *enough* to regress **our** pipeline,
but **not** a TiDB FTS/collation oracle. Engine-exact behavior (FTS ranking, collation, vector
cosine) is validated by the **nightly DB-backed run** against a TiDB Starter dev cluster — not yet
wired (tracked in `docs/IMPLEMENTATION_BACKLOG.md` E5). Until then, treat green here as "the fusion
contract holds," not "FTS matches identically in prod."
