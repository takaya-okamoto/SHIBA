# Deploy SHIBA

The deploy runbook lives in **[`terraform/README.md`](terraform/README.md)** (the source of truth —
it tracks the actual Terraform). This file is just the map so the two never drift apart again.

## TL;DR

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars   # fill it in (see README "Prerequisites")
terraform init && terraform apply              # provisions the Lightsail box + bootstraps the app
# then, once on the box (terraform output ssh_command):
#   cd /opt/shiba/app && sudo docker compose run --rm app node dist/main.js migrate
# register on Telegram with the one-time owner code from `docker compose logs app`.
```

User-facing quickstart (Japanese): **[`../docs/QUICKSTART_JA.md`](../docs/QUICKSTART_JA.md)**.

## Two facts that are easy to get wrong (settled during the live deploy)

- **TiDB is created manually**, not by Terraform — the `tidbcloud` provider churns and won't export
  the SQL password. Create a Starter cluster in the console and pass `tidb_host` / `tidb_user` /
  `tidb_port` / `tidb_password`. (terraform/README.md **Gotcha A**.)
- **Bedrock uses IAM user access keys** (`aws_access_key_id` / `aws_secret_access_key` → `.env`).
  Keyless via an instance role is **NOT possible on a plain Lightsail instance** — verified in
  production: the box's IMDS identity is AWS-owned and can't assume your role. Or use
  `model_provider = "anthropic"` + an API key. (terraform/README.md **Gotcha B**.)

Everything else — variable list, gotchas C/D, security notes, teardown — is in terraform/README.md.
