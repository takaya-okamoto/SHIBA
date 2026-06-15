# src/ — module map (Step 2 scaffold)

Single package for now; split into `packages/` only when the channel/core boundary needs to be a
published extension point (docs/90 §3-④, 92 §5). Imports use `.js` extensions (NodeNext).

| path | status | role |
|---|---|---|
| `config.ts` | ✅ | load `.env` + `config.yaml` (defaults; secrets in env) |
| `types.ts` | ✅ | core domain types (ids are strings; `sourceTrust`) |
| `index/db.ts` | ✅ | TiDB pool (TLS, keepalive, `bigNumberStrings`) |
| `index/schema.sql` | ✅ | derived index DDL (chunks/facts/entities/fact_entities; auto-embed + FTS) |
| `index/migrate.ts` | ✅ | apply schema (comment-safe split), inject embed model/dim |
| `index/embed.ts` | ✅ | `EmbeddingProvider` (tidb-auto; local = TODO) |
| `index/reindex.ts` | ✅ | rebuild from Markdown (pure `buildIndexRecords` + full DB rebuild; incremental TODO) |
| `index/chunk.ts` | ✅ | CJK-aware chunker (heading / paragraph / sentence split) |
| `search/fts.ts` | ✅ | `ftsLiteral` (escaped inline literal, 98 §6) |
| `search/rrf.ts` | ✅ | RRF fusion + untrusted demotion + autocut (unit-tested) |
| `search/provider.ts` | ✅ | **validated TiDB queries** — vector / FTS / **entity-route (IN-subquery, scale-safe)** |
| `search/entity.ts` | 🚧 partial | resolve query → entity ids (substring; trigram/embedding/LLM = TODO) |
| `search/hybrid.ts` | ✅ | orchestrate routes → fuse → demote → autocut |
| `memory/store.ts` | ✅ | Markdown+git source of truth (read tree + git commit) |
| `memory/fence.ts` | ✅ | facts fence parse/serialize (round-trip; strikethrough = forget) |
| `memory/paths.ts` | ✅ | path-traversal guard + slug validation (98 §6) |
| `session/session.ts` | ✅ | session boundary logic (idle / turn cap / daily reset) |
| `llm/client.ts` | ✅ | `LlmClient` + AnthropicLlm (API) + BedrockLlm (AWS creds: SSO local / IAM user keys on box — keyless not possible, ADR-0005). Bedrock model ids via env |
| `extract/extract.ts` | ✅ | stage-1 extraction → harden input (sanitize/scrub/strip/detect) → facts + `source_trust` clamp + claim scrub (reconcile TODO) |
| `extract/prompts.ts` | ✅ | extraction system prompt (ja; secret-not-value + source_trust + observation-date rules) |
| `security/sanitize.ts` | ✅ | Unicode hygiene (zero-width/bidi/control strip, homoglyph normalize, ZWJ-safe) + `stripInjectedContext` (98 §2.3/§3.1) |
| `security/redact.ts` | ✅ | secret/PII scrub for the memory path + always-on `redactForLog` (98 §4.2-4.3) |
| `security/injection.ts` | ✅ | injection pattern detection, EN+JA (detect≠block; 98 §2.2) |
| `extract/reconcile.ts` | ✅ | stage-2 reconcile (gather→ADD/UPDATE/DELETE/NOOP, integer-id mask, pinned guard, fail-open) |
| `turn/allowlist.ts` | ✅ | owner allowlist + one-time-code onboarding (FileAllowlist persists) |
| `turn/memory-tools.ts` | ✅ | in-turn `remember`/`forget` helpers (buildRememberFact / matchForget) |
| `turn/commands.ts` | ✅ | owner command system (`/help /search /remember /forget /status /pause /resume /digest`) + PauseRegistry |
| `turn/turn-loop.ts` | ✅ | handleMessage (allowlist→commands→recall→respond + remember/forget tools) + closeSession (extract→reconcile→supersede/append→commit→reindex) |
| `channels/telegram/classify.ts` | ✅ | message classifier (text/caption/location/contact/sticker→text; image/audio/video=unsupported) + provenance |
| `channels/telegram/stream.ts` | ✅ | throttled send→edit streaming preview (openclaw #7123): one message, ≈1/s edits, 4096 cap, skip-unchanged |
| `channels/telegram/adapter.ts` | ✅ thin | grammy long polling (all message types) → TurnLoop; streams the reply (edits one message); skips commands/paused from recording |
| `index/meta.ts` | ✅ | index identity gate (schema/embedding version; startup fail-closed on schema mismatch) |
| `index/st.ts` | ✅ | st_* access (recall log / metrics / security events / update dedup; query-hash only) |
| `session/persistence.ts` | ✅ | open-session persistence + recovery (survives restart) |
| `main.ts` | ✅ | CLI: `serve` / `migrate` / `reindex` / `search "<q>"`; serve wires meta gate + sessions + commands |

## Run

```bash
pnpm install
pnpm typecheck && pnpm test     # rrf unit tests (no DB)
# with a TiDB .env (see .env.example):
pnpm migrate                    # create schema
# (seed/reindex from Markdown = TODO; for now use poc/tidb to populate, or wait for memory/)
pnpm search "田中さんとの打ち合わせ"
```

## Status

Memory loop is end-to-end and unit-tested (131 tests): talk → recall → reply → session-boundary
extract → reconcile → Markdown+git → reindex; in-turn `remember`/`forget`; owner commands; ingest
hardening (sanitize/scrub/injection-detect/`source_trust`); index identity gate + `st_*` state;
session persistence; hybrid recall (facts + chunks, fail-open, LIKE fallback, entity ranker).

DB-touching code (provider queries, migrate, reindex, `st`/`meta` writes) is typecheck-verified;
final validation needs a live TiDB. Tracking of what's done vs deferred: research-side
`docs/IMPLEMENTATION_BACKLOG.md` (Phases A–F).

Deferred (need infra / an API decision): vision-OCR + voice-STT + SSRF guard (B3 tail); incremental
reindex (D6); local embedding provider (D7); eval harness (E5); nightly Batches + budget guard (E6);
structured-log/`/healthz` + write-queue circuit breaker (E3/E4 tail). v2+: external ingestion,
actions, MCP.

Index pipeline (with a TiDB `.env`): `MEMORY_DIR=./examples/memory pnpm migrate && MEMORY_DIR=./examples/memory pnpm reindex --all && pnpm search "田中さんとの打ち合わせ"`.
