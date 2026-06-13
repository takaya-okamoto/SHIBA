# ===========================================================================
# TiDB Cloud — free Starter (serverless) cluster = SHIBA's derived index.
# Free tier = simply OMIT `spending_limit`. Default free quota:
#   5 GiB row + 5 GiB columnar + 50M RU/month, max 5 free clusters per org.
# ===========================================================================
resource "tidbcloud_serverless_cluster" "shiba" {
  display_name = var.tidb_cluster_name

  region = {
    name = "regions/${var.tidb_region_id}"
  }

  # Uncomment to allow paid auto-scaling beyond the free quota:
  # spending_limit = {
  #   monthly = 1000 # USD cents
  # }

  lifecycle {
    # The index is rebuildable (`reindex --all`), but guard against accidental teardown.
    prevent_destroy = true
  }
}

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
    bedrock_role_arn       = join("", aws_iam_role.bedrock[*].arn) # "" when model_provider=anthropic (count 0)
    bedrock_response_model = var.bedrock_response_model
    bedrock_extract_model  = var.bedrock_extract_model
    anthropic_api_key      = var.anthropic_api_key
    telegram_bot_token     = var.telegram_bot_token
    gemini_api_key         = var.gemini_api_key
    memory_git_remote      = var.memory_git_remote
    tidb_host              = tidbcloud_serverless_cluster.shiba.endpoints.public.host
    tidb_port              = tidbcloud_serverless_cluster.shiba.endpoints.public.port
    tidb_user              = "${tidbcloud_serverless_cluster.shiba.user_prefix}.root"
    tidb_password          = var.tidb_password
    tidb_database          = var.tidb_database
  })
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
    cidrs     = [var.admin_ssh_cidr]
  }
}
