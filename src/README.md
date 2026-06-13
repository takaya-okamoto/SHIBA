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
| `llm/client.ts` | ✅ | `LlmClient` + AnthropicLlm (API) + BedrockLlm (AWS creds: SSO local / IMDS box). Bedrock model ids via env |
| `extract/extract.ts` | ✅ | stage-1 extraction → facts + `source_trust` clamp (parse-validate; reconcile TODO) |
| `extract/prompts.ts` | ✅ | extraction system prompt (ja; secret-not-value + source_trust rules) |
| `turn/allowlist.ts` | ✅ | owner allowlist + one-time-code onboarding (in-memory; TiDB TODO) |
| `turn/turn-loop.ts` | ✅ | handleMessage (allowlist→recall→respond) + closeSession (extract→fence→commit→reindex) |
| `channels/telegram/adapter.ts` | ✅ thin | grammy long polling → TurnLoop (live-untested; verify on deploy) |
| `main.ts` | ✅ | CLI: `serve` / `migrate` / `reindex` / `search "<q>"` |

## Run

```bash
pnpm install
pnpm typecheck && pnpm test     # rrf unit tests (no DB)
# with a TiDB .env (see .env.example):
pnpm migrate                    # create schema
# (seed/reindex from Markdown = TODO; for now use poc/tidb to populate, or wait for memory/)
pnpm search "田中さんとの打ち合わせ"
```

## Next (Step 3c)

Done in 3b: `llm/` (Anthropic), `extract/` (stage-1 + source_trust clamp), `turn/` (allowlist + loop),
`channels/telegram` (grammy) — orchestration unit-tested (27 tests total), SDK wiring typechecked.
Remaining (need live keys / deploy):
- run live: `MODEL_PROVIDER=anthropic ANTHROPIC_API_KEY=… TELEGRAM_BOT_TOKEN=… pnpm serve`
- session store + idle sweep to auto-fire `closeSession` (the "remember" trigger)
- extract stage-2 reconcile (ADD/UPDATE/DELETE); Bedrock LLM client (`@anthropic-ai/bedrock-sdk` + IMDS)
- recall boosts / rerank (101 §7); action gate (v2+)

Index pipeline (with a TiDB `.env`): `MEMORY_DIR=./examples/memory pnpm migrate && MEMORY_DIR=./examples/memory pnpm reindex --all && pnpm search "田中さんとの打ち合わせ"`.
