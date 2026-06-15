# SHIBA — Terraform (AWS Lightsail)

One `terraform apply` provisions the **AWS Lightsail** half of the SHIBA stack: the resident
24/7 VPS (Ubuntu 22.04, 4GB) that bootstraps Docker, clones the app, renders `.env`, and starts
it. Telegram uses **long polling**, so there is **no public endpoint** — the only open port is
SSH, locked to your IP.

The **TiDB Cloud Starter** cluster (the free derived index: vector + full-text + auto-embedding)
is created **manually** in the console and passed in via the `tidb_*` variables — see Gotcha A.

> It is *near* one-command, not magic: gather a few secrets first (Telegram bot, TiDB connection,
> Bedrock IAM keys), and mind the gotchas below.

## Prerequisites (gather before `apply`)

1. **Telegram bot** — create via [@BotFather](https://t.me/BotFather), copy the token.
2. **TiDB Cloud Starter cluster** — console → Create Cluster → Starter (free) → **AWS Tokyo**.
   From the Connect dialog copy host / port / user (`<prefix>.root`) and reset the SQL password.
3. **Bedrock** (when `model_provider = "bedrock"`) — submit the Anthropic Claude **model-access
   (FTU) form** once; create an **IAM user** with `bedrock:InvokeModel[WithResponseStream]` and an
   access key; find the `jp.` inference-profile ids via
   `aws bedrock list-inference-profiles --region ap-northeast-1`.
   *(Or use `model_provider = "anthropic"` + an API key.)*
4. An **SSH key** (`ssh-keygen -t ed25519`) and your public IP (`curl ifconfig.me`).
5. Terraform ≥ 1.6, AWS credentials in your shell (for the apply itself).

## Run

```bash
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars

terraform init
terraform apply        # creates the Lightsail box, bootstraps the app

# then, once on the box (terraform output ssh_command):
#   cd /opt/shiba/app && sudo docker compose run --rm app node dist/main.js migrate
# and register on Telegram with the one-time owner code from `docker compose logs app`.
```

`terraform output next_steps` prints the finish-up checklist.

## Gotchas (read these — found during the infra spike)

**A. The TiDB cluster is NOT managed by Terraform.** The `tidbcloud` provider (v0.4.x) churns on
updates to an existing cluster (`auto_scaling` "inconsistent result"; "can't set both spending
limit and capacity"), and it doesn't export the SQL password anyway. So the cluster is created
once in the console and its connection details are passed via `tidb_host` / `tidb_user` /
`tidb_port` / `tidb_password`. If `tidb_password` is empty the bootstrap skips `docker compose up`,
so a two-step (apply → set password → apply) is safe.

**B. Bedrock uses IAM user access keys — keyless is NOT possible on a plain Lightsail instance.**
A plain Lightsail instance's IMDS identity is the AWS-owned `AmazonLightsailInstanceRole`. You
cannot grant your own role a cross-account `AssumeRole` from AWS's account, so role-chaining fails
with AccessDenied (verified during the spike). Set `aws_access_key_id` / `aws_secret_access_key`
(an IAM user limited to `bedrock:InvokeModel*`); they're written to the box's `.env`, and the app's
`AnthropicBedrock` SDK reads them from the environment (the default AWS chain prefers env vars).
Claude 4.x needs an **inference profile** (on-demand unsupported) — Tokyo ids use the `jp.` prefix.

**C. Secrets land in tfstate and in Lightsail user_data.** The rendered `.env` is visible in
`terraform.tfstate` and in instance metadata. For a personal prototype that's acceptable, but keep
`terraform.tfvars` and `*.tfstate` private (they are gitignored here), and prefer an encrypted
remote backend (e.g. S3) over local state if anyone else can read your disk.

**D. cloud-init runs under /bin/sh (dash), not bash.** `user_data.sh.tftpl` therefore uses
`set -eu` (no `pipefail` / `[[ ]]` / arrays) and sets an apt `DPkg::Lock::Timeout` so first-boot
unattended-upgrades holding the apt lock don't make the bootstrap fail.

## Security notes

- **No inbound app port.** `aws_lightsail_instance_public_ports` lists only SSH; ports 80/443
  (open by default on Lightsail) are closed. Public attack surface = 0 with long polling.
- Lock `admin_ssh_cidr` to your `/32`(s). It's a **list**, so you can register multiple networks
  (e.g. `["203.0.113.4/32", "198.51.100.7/32"]`) — home + office + phone. IPs are usually dynamic, so
  re-apply when one changes (find the current one with `curl -4 ifconfig.me`). Rotate the Telegram /
  Bedrock / TiDB credentials as passwords.
- The memory git remote (`memory_git_remote`) should be a **private** repo.

## Teardown

```bash
terraform destroy   # removes the Lightsail box. The (manually created) TiDB cluster is untouched.
```

Your memory (Markdown + git) is unaffected; `reindex --all` rebuilds the TiDB index. Delete the
TiDB cluster separately in the console if you want it gone.

## Lightsail vs EC2

This skeleton targets **Lightsail** (simple, fixed price, AWS's OpenClaw blueprint reference).
Bedrock here uses **IAM user keys** rather than an instance role, because keyless role-chaining is
not viable on a plain Lightsail instance (Gotcha B). EC2 would buy a declarative instance profile
(true keyless) and finer networking control, at the cost of managing the security group / EIP
yourself. For SHIBA v1, stay on Lightsail; an EC2 variant could live in `deploy/terraform-ec2/`
later without touching the rest.
