# Architecture Decision Records

Short records of the load-bearing decisions behind SHIBA — the "why", with enough context that a
future reader (or contributor) doesn't have to reverse-engineer it from the code. Each ADR is
Status / Context / Decision / Consequences.

| # | Decision |
|---|---|
| [0001](0001-tidb-derived-index.md) | TiDB Cloud Starter as the single derived index (vector + full-text + auto-embed) |
| [0002](0002-resident-vps.md) | A resident VPS (AWS Lightsail), not serverless |
| [0003](0003-markdown-git-source-of-truth.md) | Markdown + git is the source of truth; the DB is rebuildable |
| [0004](0004-telegram-io.md) | Telegram (long polling) as the v1 I/O channel |
| [0005](0005-bedrock-iam-keys.md) | Bedrock via IAM user keys — keyless is not possible on plain Lightsail |
| [0006](0006-add-plus-background-reconcile.md) | Inline ADD + background reconcile, not an inline self-correction loop |
| [0007](0007-v1-memory-only.md) | v1 is memory-only (no outward actions) to avoid the lethal trifecta |
