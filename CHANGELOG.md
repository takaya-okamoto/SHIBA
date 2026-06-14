# Changelog

All notable changes to SHIBA are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Nightly dreaming (`DreamScheduler` + reconcile): once a day (default 03:00 JST) reviews active
  facts for contradictions/duplicates and stores short insights; the next morning's digest surfaces
  them ("🌙 ゆうべ気づいたこと"). NON-DESTRUCTIVE — it never edits facts; the owner decides what to do.
- Morning digest (`DigestScheduler`): once a day at a configurable hour (default 08:00 JST), outside
  quiet hours (22:00–07:00), proactively sends the owner today's + overdue commitments. Honors the
  silence principle (skips when there's nothing to report); last-sent date is persisted to
  `./data/state/digest.json`. Adds proactive send (`Notifier` via the Telegram adapter) and
  `AllowlistStore.list()`.
- Recency decay in recall (`recencyBoost`): dated facts (event/commitment) lose weight with age
  (`score *= exp(-(ln2/halfLife)*ageDays)` on `recorded_at`, default 30-day half-life), while
  evergreen kinds (preference/belief/fact) are exempt. Applied after RRF + untrusted demotion;
  tunable via `search.recencyHalfLifeDays` / `search.decayEnabled`.
- Persistent allowlist (`FileAllowlist`, `./data/state/allowlist.json` on the mounted volume):
  owner registration now survives restarts/redeploys; a one-time setup code is printed only on a
  fresh install (nobody registered yet), and an empty code never registers anyone.
- Prompt caching (1h TTL) + model-driven `memory_search` tool: the system prompt (persona +
  memory protocol) and tool definitions form a byte-stable cached prefix; recall is injected on
  the current user turn so `system` stays cacheable; the model may call `memory_search` to go
  deeper. `respond()` now runs a tool loop, shared across the Anthropic and Bedrock clients.
- Short-term conversation context: the last 30 messages of the open session are passed to the
  LLM each turn (`SessionManager.recentHistory`), alongside the searched long-term memories;
  reset at the session boundary so a new topic doesn't inherit stale context.
- Session-boundary memory flush (Step 3c): the owner's conversation is accumulated per session
  and, at the boundary (idle timeout / turn cap / daily reset), extracted into facts and
  committed (`SessionManager` drives `TurnLoop.closeSession`; a periodic sweep + shutdown flush
  cover sessions that simply go quiet).
- Initial SHIBA app: Telegram channel adapter, per-user turn loop, hybrid recall
  (vector + full-text + entity route) over TiDB Cloud Starter, fact extraction,
  Markdown+git memory store, and `migrate` / `reindex` CLI commands.
- LLM clients for the Anthropic API and Amazon Bedrock (`@anthropic-ai/bedrock-sdk`).
- Terraform for AWS Lightsail: one `apply` bootstraps the box (Docker, clone, `.env`, start).
  The TiDB Cloud Starter cluster is created manually and passed in via `tidb_*` variables.
- Owner onboarding via a one-time setup code (default-deny allowlist).
- `source_trust` memory-laundering defense.

### Notes
- v1 scope is **memory only** — no outbound actions, no Gmail/Calendar ingestion
  (so it has no *lethal trifecta* by construction).
