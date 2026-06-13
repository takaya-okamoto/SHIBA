# `terraform test` — validates plan-time logic with MOCK providers (no AWS/TiDB credentials,
# no real resources). Run: terraform test

mock_provider "aws" {}

mock_provider "tidbcloud" {
  # Supply the cluster's computed connection fields so the user_data templatefile renders.
  mock_resource "tidbcloud_serverless_cluster" {
    defaults = {
      user_prefix = "abc123"
      endpoints   = { public = { host = "gateway01.example", port = 4000 } }
    }
  }
}

variables {
  ssh_public_key       = "ssh-ed25519 AAAATESTKEY you@host"
  admin_ssh_cidr       = "203.0.113.4/32"
  tidb_api_public_key  = "pub"
  tidb_api_private_key = "priv"
  telegram_bot_token   = "123:abc"
  gemini_api_key       = "gkey"
}

run "defaults_bedrock_creates_role_and_ssh_only" {
  command = plan

  assert {
    condition     = length(aws_iam_role.bedrock) == 1
    error_message = "default model_provider=bedrock must create the Bedrock IAM role"
  }
  assert {
    condition     = length(aws_lightsail_instance_public_ports.shiba.port_info) == 1
    error_message = "only SSH (1 port) should be open — Telegram long polling has no inbound app port"
  }
  assert {
    condition     = aws_lightsail_instance.shiba.bundle_id == "medium_3_0"
    error_message = "default instance plan should be 4GB (medium_3_0)"
  }
}

run "anthropic_skips_bedrock_role" {
  command = plan
  variables {
    model_provider    = "anthropic"
    anthropic_api_key = "sk-ant-test"
  }
  assert {
    condition     = length(aws_iam_role.bedrock) == 0
    error_message = "model_provider=anthropic must NOT create the Bedrock IAM role"
  }
}

run "rejects_invalid_model_provider" {
  command = plan
  variables {
    model_provider = "openai"
  }
  expect_failures = [var.model_provider]
}
