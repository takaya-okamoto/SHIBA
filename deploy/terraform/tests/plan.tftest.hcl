# `terraform test` — validates plan-time logic with a MOCK aws provider (no credentials,
# no real resources). Run: terraform test

mock_provider "aws" {}

variables {
  ssh_public_key     = "ssh-ed25519 AAAATESTKEY you@host"
  admin_ssh_cidr     = ["203.0.113.4/32"]
  telegram_bot_token = "123:abc"
}

run "ssh_only_and_4gb_default" {
  command = plan

  assert {
    condition     = length(aws_lightsail_instance_public_ports.shiba.port_info) == 1
    error_message = "only SSH (1 port) should be open — Telegram long polling has no inbound app port"
  }
  assert {
    condition     = aws_lightsail_instance.shiba.bundle_id == "medium_3_0"
    error_message = "default instance plan should be 4GB (medium_3_0)"
  }
}

run "rejects_invalid_model_provider" {
  command = plan
  variables {
    model_provider = "openai"
  }
  expect_failures = [var.model_provider]
}
