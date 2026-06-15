# 0004 — Telegram (long polling) as the v1 I/O channel

**Status:** Accepted

## Context
The agent needs a chat surface the owner already uses, with no per-message cost, no send caps, and
ideally no public endpoint to secure. LINE (an early candidate) charges past a free tier and needs a
public webhook; a custom app is friction.

## Decision
Use **Telegram Bot API with long polling** as the v1 channel. Long polling holds an outbound
`getUpdates` connection, so there is **no inbound port and no public domain** — it's free, has no
send cap, and no 60-second reply constraint. The channel sits behind a thin `ChannelAdapter`, so LINE
or others can be added later without touching the core.

## Consequences
- Zero public attack surface (ADR-0002); onboarding is a one-time owner code over DM.
- Webhook mode is possible later (with a secret-token check + `st_update_dedup` idempotency, already
  scaffolded) if a push model is ever wanted.
- Anyone can DM a bot → access is default-deny; only the registered owner's messages touch memory.
