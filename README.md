<p align="center">
  <strong>🐕 SHIBA</strong><br/>
  <em>Your own AI agent that actually remembers you.</em><br/>
  Just talk on Telegram. Your memory lives on your server, as yours.
</p>

<p align="center">
  English ·  <a href="README.ja.md">日本語</a>
</p>

---

## What is SHIBA?

SHIBA is a **self-hosted personal memory agent**.

- **Remembers** — automatically captures what matters from your Telegram chats and recalls it across sessions and devices.
- **Recalls** — hybrid vector + full-text search returns just the memories you need, when you need them (Japanese is first-class).
- **Yours** — memory is stored as human-readable Markdown on **your server (AWS Lightsail) and your GitHub repo**. No vendor lock-in; export anytime.
- **Lives in Telegram** — no app to install; Telegram *is* the interface. No public domain needed (it runs on long polling).

> **v1 scope is memory only.** Outward **actions** (replying to email, creating calendar events) are **not** in v1 — they come in a later phase, once the safety requirements are in place. As a result v1 structurally **does not have the *lethal trifecta*** (private data × untrusted input × the ability to act) — see [Security](#security).

---

## Quickstart

The full step-by-step setup (≈30–60 min, from zero to chatting on Telegram) is in **[`docs/QUICKSTART_JA.md`](docs/QUICKSTART_JA.md)** (Japanese). Deploy runbook: **[`deploy/terraform/README.md`](deploy/terraform/README.md)**.

```bash
cp .env.example .env        # fill in Telegram / model / TiDB credentials
docker compose up -d        # one resident process; long polling, no inbound ports
# then DM the bot the one-time owner code from the logs to register.
```

---

## Architecture

```
   You (owner) ── 📱 Telegram ──► Telegram Bot API (long polling; free, no public endpoint)
                                          │
                                          ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  AWS Lightsail (resident 24/7 VPS, 4GB)   ◀── the SHIBA app runs here │
   │    ├ Channel Adapter : Telegram I/O                                  │
   │    ├ Turn Loop       : per-user serial reply generation             │
   │    └ Background Worker: extraction / dreaming / morning digest      │
   │    📁 data/memory/  ◀── SOURCE OF TRUTH: Markdown + git             │
   │    📁 data/state/   ◀── session transcripts (JSONL) + local state    │
   └───────┬──────────────────────┬─────────────────────┬──────────────┘
           ▼                      ▼                     ▼
     TiDB Cloud Starter      LLM (Anthropic        GitHub (private repo)
     DERIVED INDEX           API or Bedrock)       offsite memory backup
     vector + full-text      reply / extract /     (git push)
     + auto-embed + state    nightly batch
       ↑ rebuildable from data/memory via `reindex --all`
```

| Service | Role | Stores |
|---|---|---|
| **Telegram Bot API** | Day-to-day I/O (long polling default / webhook optional). Free, no send cap, no public domain. | — |
| **AWS Lightsail** (resident VPS) | Where SHIBA runs 24/7; holds the **source of truth** (Markdown + git) on local disk. | `data/memory/`, `data/state/` |
| **TiDB Cloud Starter** | **Derived index**: hybrid search (vector + full-text), in-DB auto-embedding, fact state. **Drop it and `reindex` rebuilds it.** | `chunks` / `facts` / `entities` / `fact_entities` |
| **LLM** (Anthropic API or Amazon Bedrock) | Reply generation, extraction/reconcile, nightly batch. **Sends text only; stores nothing.** | — |
| **GitHub** (private repo) | Offsite backup of the memory git repo. | mirror of `data/memory/` |

> Ingesting external data (Gmail / Calendar) and outward actions are out of scope for v1 (planned for v2+).

---

## Cost

Personal use (~20 turns/day): **roughly $35–45 / month** — Lightsail 4GB (~$20–24), LLM (~$20), TiDB Starter / Telegram / GitHub free. Drop to a 2GB box (~$12) for ~$30s/mo. (2026-06 estimate; verify current pricing.)

---

## Security

Designed on the assumption that **the LLM can be hijacked**, so boundaries are enforced **structurally, not by trusting the model**:

- **v1 takes no outward actions and ingests no external data** — the third leg of the *lethal trifecta* is structurally absent, so "an email instructs the agent to act as you" attacks simply can't occur.
- **Access boundary (default deny)** — only the registered owner's messages touch memory; owner registration uses a one-time code.
- **Prompt-injection defense** — external text (forwarded / pasted / OCR) is wrapped in `<untrusted_input>` (data, not instructions), with input+output sanitization, Unicode normalization, and Japanese paraphrase patterns.
- **Memory-laundering defense (`source_trust`)** — facts extracted from forwarded/pasted/OCR'd text are marked `untrusted`: never auto-promoted to resident memory, demoted + labeled on recall, never a trigger for (future) actions. Only an explicit `/remember` promotes to trusted.
- **Secret handling (three layers)** — "store the fact, not the value" prompting, pre-ingest PII/secret scrub (Luhn-checked), and import-time log redaction that can't be disabled at runtime.
- **No telemetry** — the only outbound traffic is to the services you configure (LLM / TiDB / Telegram).

See [`SECURITY.md`](SECURITY.md) for the policy and vulnerability reporting.

---

## Features

- 🧠 **Persistent memory** — extracts facts from conversation, reconciles contradictions (ADD/UPDATE/DELETE), promotes spaced-repetition recalls to long-term memory.
- 🔍 **Hybrid search** — vector + full-text (BM25) fused, Japanese-first, with entity connections boosting precision.
- ☀️ **Morning digest** — yesterday's highlights, today's and overdue commitments.
- ⏳ **Time-aware** — resolves "yesterday" / "last weekend" to absolute dates.
- 🔒 **Private** — your infra, your data.

## Owner commands (Telegram)

`/help` · `/search <q>` · `/remember <x>` · `/forget <x>` · `/status` · `/pause` · `/resume`. Conversation is captured automatically; commands are for explicit control and are never stored as memory.

---

## Tech stack

TypeScript + Node 22 + pnpm · AWS Lightsail (Docker Compose) · TiDB Cloud Starter (MySQL-compatible, vector + full-text + auto-embed) · Markdown + git (source of truth) + GitHub backup · Telegram · Anthropic API or Amazon Bedrock (Claude) · Apache-2.0.

Design rationale (why TiDB, why a resident VPS, why Markdown-as-truth, why ADD + background reconcile) is recorded in [`docs/adr/`](docs/adr/).

---

## Contributing

The project language is **English** (code, comments, commits, issues; some docs are Japanese). See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), and [`CHANGELOG.md`](CHANGELOG.md).

## License

Apache License 2.0 — see [`LICENSE`](LICENSE) / [`NOTICE`](NOTICE).

## Why "SHIBA"?

After the Shiba Inu 🐕 — loyal, smart, by your side, and it remembers you. The detailed Japanese README is at [`README.ja.md`](README.ja.md).
