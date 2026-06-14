# Changelog

All notable changes to SHIBA are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
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
