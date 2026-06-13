# Deploy SHIBA to AWS Lightsail (Bedrock)

End-to-end runbook for the chosen path: **Lightsail (24/7) + Bedrock (option B)**. Terraform
provisions the box + TiDB cluster + IAM role and bootstraps the app; the steps marked **(manual)**
can't be Terraformed.

## 0. Gather (one-time, manual)

1. **AWS**: `aws sso login --profile <p>`. Pick a region where **Bedrock has Anthropic Claude** (Tokyo
   `ap-northeast-1` uses **APAC cross-region inference profiles**). 
2. **Bedrock FTU (manual)**: Bedrock console → *Model access* → request Anthropic Claude (submit the
   use-case form). Once per account. Without it, invokes are denied.
3. **Bedrock model ids**: `aws bedrock list-inference-profiles --region ap-northeast-1` → pick a
   response model (Sonnet) and an extract model (Haiku), e.g. `apac.anthropic.claude-sonnet-4-...`.
4. **TiDB Cloud**: create account → Organization Settings → API Keys → public + private key.
5. **Telegram (manual)**: @BotFather → `/newbot` → bot token.
6. **GitHub PAT**: fine-grained, **read-only Contents** on `takaya-okamoto/SHIBA` (the repo is private,
   so the box needs it to clone). 
7. **SSH key** (`ssh-keygen -t ed25519`) + your public IP (`curl ifconfig.me`).

## 1. tfvars

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars
```
Fill: `aws_region`/`aws_availability_zone`, `ssh_public_key`, `admin_ssh_cidr` (your `/32`),
`tidb_api_public_key`/`tidb_api_private_key`, `model_provider="bedrock"`,
`bedrock_response_model`/`bedrock_extract_model`, `github_repo_token`, `telegram_bot_token`,
`tidb_password=""` (empty on first apply). `gemini_api_key` can stay empty (free Titan embedding).

## 2. apply

```bash
AWS_PROFILE=<p> terraform init
AWS_PROFILE=<p> terraform apply
```
Creates Lightsail + TiDB Starter + IAM role + writes `.env` and `~/.aws/config` and runs
`docker compose up`. The app won't fully start yet (TiDB password is empty).

## 3. TiDB password (Gotcha A)

TiDB Cloud console → this cluster → reset the SQL password → put it in `terraform.tfvars`
(`tidb_password`) → `AWS_PROFILE=<p> terraform apply` again (re-renders `.env`, restarts the app).

## 4. Migrate the schema (one-off, on the box)

```bash
eval "$(terraform output -raw ssh_command)"          # SSH in
cd /opt/shiba/app
sudo docker compose run --rm app node dist/main.js migrate
```

## 5. Confirm Bedrock creds reach the box (the IMDS spike)

On the box (host):
```bash
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/iam/security-credentials/
```
- Prints a role name → IMDS exposes assumable creds; Bedrock role-chaining should work.
- Empty / 404 → a plain Lightsail instance isn't chainable. **Fall back**: set
  `model_provider="anthropic"` + `anthropic_api_key` in tfvars and re-apply.

## 6. Register on Telegram + converse

```bash
sudo docker compose logs app | grep "owner setup code"   # the one-time code
```
DM the bot → it asks for the setup code → send the code → registered → converse.
(The functional Bedrock test is simply: does the bot reply? If creds/model are wrong, `docker compose
logs app` shows the error.)

## Honest caveats

- **Bedrock first-light is the hardest path.** If anything in 5/6 fails, switch `model_provider="anthropic"`
  (one tfvar + re-apply) — that path is fully implemented and the most reliable.
- **Remembering across sessions is not auto-scheduled yet** (Step 3c): the bot recalls + responds, but
  `closeSession` (extract → write fence → reindex) isn't fired by an idle sweep yet. So new facts aren't
  auto-persisted until that's wired.
- **TiDB free-tier creation via the provider** is confirmed only when `apply` succeeds (first live check).
- **PAT + secrets** land in `terraform.tfstate` and Lightsail instance metadata — keep state private
  (prefer an encrypted remote backend), and use a least-privilege, expiring PAT.
- `tidb_region_id` default `aws-ap-northeast-1` — `apply` will reject it if wrong.
