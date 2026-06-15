# 0005 — Bedrock via IAM user keys; keyless is not possible on plain Lightsail

**Status:** Accepted (corrects an earlier assumption — verified in production)

## Context
We wanted "keyless" Bedrock (no long-lived secret on the box) via an instance role, like EC2/ECS
instance profiles. AWS's OpenClaw Lightsail blueprint *does* attach a per-instance role
(`LightsailRoleFor-<id>`), which suggested keyless should work. We initially wrote it up that way.

## Decision
**Use IAM user access keys** (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in `.env`). Keyless role-
chaining is **not possible on a plain Lightsail instance**: the box's IMDS identity is the AWS-owned
`AmazonLightsailInstanceRole` (in AWS's account), and you cannot grant a cross-account `AssumeRole`
from AWS's account to your role → `AccessDenied`. Confirmed empirically during the deploy spike (not
just from docs). The OpenClaw blueprint boxes are a special-cased exception, not the general case.

Claude 4.x needs an **inference profile** (on-demand unsupported); Tokyo ids use the `jp.` prefix,
discovered via `aws bedrock list-inference-profiles` — never guessed. `model_provider = "anthropic"`
(an API key) is the simplest alternative.

## Consequences
- A long-lived IAM key lives in `.env` (0600) — scoped to `bedrock:InvokeModel*`, rotated like a password.
- No `~/.aws` mount is needed (the SDK reads env vars first); the earlier mount was removed.
- Lesson recorded so the "keyless works" assumption isn't reintroduced (see research `docs/LEARNINGS.md`).
