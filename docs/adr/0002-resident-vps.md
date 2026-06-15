# 0002 — A resident VPS (AWS Lightsail), not serverless

**Status:** Accepted

## Context
The agent needs background work (extraction, nightly "dreaming", morning digest), per-user serial
turn handling with no 60-second timeout, long-polling that holds an outbound connection, and a local
git working tree as the source of truth. Serverless/functions fight all of these (cold starts,
execution caps, no resident disk, no long-lived poll).

## Decision
Run as a **single resident process on AWS Lightsail** (Ubuntu, 4GB — AWS's own OpenClaw blueprint
references 4GB), via Docker Compose. Telegram long polling means **no inbound ports** (only SSH,
locked to the owner's IP); public attack surface is zero.

## Consequences
- Fixed, predictable cost (~$20/mo for 4GB; 2GB works for less).
- Background schedulers and the git working tree just live in the process / on disk.
- One box to keep patched; memory survives box loss via the GitHub backup (ADR-0003).
