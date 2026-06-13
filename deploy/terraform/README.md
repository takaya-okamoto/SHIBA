# SHIBA — Terraform (AWS Lightsail + TiDB Cloud)

One `terraform apply` provisions both halves of the SHIBA stack:

- **AWS Lightsail** — the resident 24/7 VPS (Ubuntu 22.04, 4GB). Bootstraps Docker, clones the app, renders `.env`, and starts it.
- **TiDB Cloud Starter** — the free derived index (vector + full-text + auto-embedding).

The Lightsail instance's `.env` is wired automatically from the TiDB cluster's outputs (host/port/user). Telegram uses **long polling**, so there is **no public endpoint** — the only open port is SSH, locked to your IP.

> It is *near* one-command, not magic. You must gather a handful of secrets first (there's no Terraform for a Telegram bot), and there's a one-time TiDB password step. See the gotchas.

## Prerequisites (gather before `apply`)

1. **Telegram bot** — create via [@BotFather](https://t.me/BotFather), copy the token. *(No Terraform exists for this.)*
2. **TiDB Cloud API key** — console → Organization Settings → API Keys.
3. **Anthropic API key** (or plan to use Bedrock — read Gotcha B first).
4. **Gemini API key** — for TiDB auto-embedding (BYOK).
5. An **SSH key** (`ssh-keygen -t ed25519`), and your public IP (`curl ifconfig.me`).
6. Terraform ≥ 1.6, AWS credentials in your shell (`aws configure` / SSO / env).

## Run

```bash
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars (leave tidb_password = "" for now)

terraform init
terraform plan
terraform apply        # creates the cluster + the box, bootstraps the app

# --- one-time TiDB password (Gotcha A) ---
# TiDB Cloud console -> cluster -> reset SQL password -> put it in terraform.tfvars
terraform apply        # re-renders .env on the box and starts the app
```

`terraform output next_steps` prints the finish-up checklist (SSH verify, owner one-time code).

## Gotchas (read these — found during the infra spike)

**A. TiDB serverless password is not managed by Terraform.**
`tidbcloud_serverless_cluster` exports `endpoints.public.host/port` and `user_prefix` but **no password**. Flow: first `apply` creates the cluster → reset the SQL password once in the console → put it in `terraform.tfvars` → `apply` again. The bootstrap skips `docker compose up` while the password is empty, so the two-step is safe.

**B. Keyless Bedrock DOES work on Lightsail (via an instance IAM role).**
An earlier draft of this file wrongly claimed Lightsail can't assume IAM roles. The AWS OpenClaw blueprint proves otherwise: its setup script creates `LightsailRoleFor-<instance-id>` and attaches it as the **instance profile**, granting Bedrock (+ Marketplace) access — **no API keys on the box**. So both options are viable on Lightsail: `anthropic_api_key` (simplest) or keyless Bedrock via the instance role. ✅ **Now wired:** when `model_provider = "bedrock"`, Terraform writes `~/.aws/config` on the box (`role_arn` + `credential_source = Ec2InstanceMetadata`) and `compose.yml` mounts it into the app container — this is role-**chaining**, not an EC2 instance profile. The app's `BedrockLlm` (`@anthropic-ai/bedrock-sdk`) then assumes the role. ⚠️ **One link still needs the spike below:** whether a *plain* Lightsail instance's IMDS exposes an assumable base identity. Also set `bedrock_response_model`/`bedrock_extract_model` and submit the FTU form (next).

**C. Secrets land in tfstate and in Lightsail user_data.**
The rendered `.env` is visible in `terraform.tfstate` and in instance metadata. For a personal prototype that's acceptable, but: keep `terraform.tfvars` and `*.tfstate` private (they are gitignored here), and prefer a private **remote backend** (e.g. S3 + encryption) over local state if anyone else can read your disk. A cleaner production path (SSM SecureString) needs an IAM role — which loops back to Gotcha B / EC2.

## Option B: keyless Bedrock (chosen) — mechanism + the one spike

`model_provider = "bedrock"` (default) wires Bedrock with **no API key on the box**, via role-chaining — the same way the AWS OpenClaw blueprint does it:

1. `bedrock.tf` creates `<instance_name>-bedrock`: a role trusting the Lightsail service identity `arn:aws:sts::<acct>:assumed-role/AmazonLightsailInstance/*`, with `bedrock:InvokeModel(+Stream)` + the three `aws-marketplace:*` permissions (those let Bedrock auto-subscribe Anthropic/Claude on first use).
2. The instance's SDK assumes that role using IMDS base creds — `~/.aws/config`: `role_arn = <bedrock_role_arn>`, `credential_source = Ec2InstanceMetadata`.
3. **One-time, manual (can't be Terraformed):** submit the Bedrock **First Time Use** form for Anthropic models in the Bedrock console (once per account/org).

### ⚠️ Run this 15-min spike BEFORE relying on B

The role + policy are correct. The unverified link is whether a **plain Ubuntu** Lightsail instance (not the OpenClaw blueprint) exposes an assumable IMDS identity. SSH into a test instance:

```bash
# 1. Does IMDS expose role credentials at all?
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/
#   -> prints a role name = chainable (good).   empty/404 = NOT chainable.

# 2. Base identity (install awscli first):
aws sts get-caller-identity      # expect .../assumed-role/AmazonLightsailInstance/i-...

# 3. After `terraform apply` made the role and you wrote ~/.aws/config (step 2 above):
aws sts get-caller-identity      # now shows .../<instance_name>-bedrock/...
```

- **Step 1 prints a role** → B works. `~/.aws/config` is already written by `user_data` and mounted by `compose.yml`; just confirm `docker compose exec app aws sts get-caller-identity` shows the `<name>-bedrock` role, set `bedrock_*_model` ids, and submit the Bedrock FTU form once.
- **Step 1 empty/404** → a plain Lightsail instance isn't chainable; switch to `model_provider = "anthropic"` + an API key (one-line change). No other rework.

> Container note: the app runs in Docker, so the assumed-role creds must reach the container (mount `~/.aws` + `AWS_CONFIG_FILE`, or let the SDK hit IMDS directly). Finalized at the compose step, after the spike.

## Security notes

- **No inbound app port.** `aws_lightsail_instance_public_ports` lists only SSH; ports 80/443 (open by default on Lightsail) are closed. Matches `docs/98 §1.2` (public attack surface = 0 with long polling).
- Lock `admin_ssh_cidr` to your `/32`. Rotate the Telegram/Anthropic/Gemini keys as passwords.
- The memory git remote (`memory_git_remote`) should be a **private** repo.

## Teardown

```bash
terraform destroy
```

The TiDB cluster has `prevent_destroy = true` (the index is rebuildable but we guard accidents). Remove that lifecycle block first if you really mean to delete it — your memory (Markdown+git) is unaffected; `reindex --all` rebuilds the index.

## Lightsail vs EC2

This skeleton targets **Lightsail** (per `docs/91`: simple, fixed price, AWS's OpenClaw blueprint reference). The earlier worry that Lightsail blocks keyless Bedrock / SSM was **wrong** (see Gotcha B) — Lightsail supports an instance IAM role, so there is **no IAM-driven reason to switch**. EC2 would only be worth it for richer Terraform coverage (declarative instance profile) or finer networking control, at the cost of managing the security group / EIP yourself. **For SHIBA v1, stay on Lightsail.** An EC2 variant could be added later as `deploy/terraform-ec2/` without touching the TiDB half.
