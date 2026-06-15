# ===========================================================================
# TiDB Cloud Starter (serverless) = SHIBA's derived index — created MANUALLY.
# The cluster is NOT managed by Terraform: the tidbcloud provider v0.4.x churns on
# updates to an existing cluster (auto_scaling "inconsistent result"; "can't set both
# spending limit and capacity"). Create it once in the console (free tier = omit the
# spending limit) and pass its Connect-dialog details via the tidb_* variables. See README.
# ===========================================================================

# ===========================================================================
# Lightsail — resident 24/7 VPS = SHIBA app + source of truth (Markdown+git).
# ===========================================================================
resource "aws_lightsail_key_pair" "shiba" {
  name       = "${var.instance_name}-key"
  public_key = var.ssh_public_key
}

resource "aws_lightsail_instance" "shiba" {
  name              = var.instance_name
  availability_zone = var.aws_availability_zone
  blueprint_id      = var.lightsail_blueprint_id
  bundle_id         = var.lightsail_bundle_id
  key_pair_name     = aws_lightsail_key_pair.shiba.name

  # Bootstrap: install Docker, clone SHIBA, render .env, start (if TiDB password is set).
  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    repo_url               = var.shiba_repo_url
    github_repo_token      = var.github_repo_token
    model_provider         = var.model_provider
    aws_region             = var.aws_region
    aws_access_key_id      = var.aws_access_key_id
    aws_secret_access_key  = var.aws_secret_access_key
    bedrock_response_model = var.bedrock_response_model
    bedrock_extract_model  = var.bedrock_extract_model
    anthropic_api_key      = var.anthropic_api_key
    telegram_bot_token     = var.telegram_bot_token
    gemini_api_key         = var.gemini_api_key
    memory_git_remote      = var.memory_git_remote
    tidb_host              = var.tidb_host
    tidb_port              = var.tidb_port
    tidb_user              = var.tidb_user
    tidb_password          = var.tidb_password
    tidb_database          = var.tidb_database
  })

  # user_data only runs at first boot and CANNOT be updated in place on Lightsail — a diff would
  # otherwise force-replace the whole instance (destroying its on-disk source-of-truth + changing the
  # IP). Ignore it so routine applies (e.g. a firewall/cidr change) never recreate the box. To
  # intentionally re-bootstrap, run `terraform apply -replace=aws_lightsail_instance.shiba`. (ADR-0002.)
  lifecycle {
    ignore_changes = [user_data]
  }
}

# ===========================================================================
# Firewall — Telegram long polling is OUTBOUND-only => NO public app port.
# This block is authoritative: by listing only SSH, ports 80/443 (open by
# default on Lightsail) are CLOSED. Public attack surface = 0 (see docs/98 §1.2).
# ===========================================================================
resource "aws_lightsail_instance_public_ports" "shiba" {
  instance_name = aws_lightsail_instance.shiba.name

  port_info {
    protocol  = "tcp"
    from_port = 22
    to_port   = 22
    cidrs     = var.admin_ssh_cidr
  }
}
