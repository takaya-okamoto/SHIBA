# ---------------------------------------------------------------------------
# Region / sizing
# ---------------------------------------------------------------------------
variable "aws_region" {
  description = "AWS region for Lightsail. Keep in Tokyo to match TiDB (lowest latency, data residency)."
  type        = string
  default     = "ap-northeast-1"
}

variable "aws_availability_zone" {
  description = "Lightsail AZ. Must be inside aws_region."
  type        = string
  default     = "ap-northeast-1a"
}

variable "lightsail_bundle_id" {
  description = "Lightsail plan. medium_3_0 = 4GB RAM / 2 vCPU (AWS-recommended size for OpenClaw/SHIBA). small_3_0 = 2GB (cheaper)."
  type        = string
  default     = "medium_3_0"
}

variable "lightsail_blueprint_id" {
  description = "OS image. Ubuntu 22.04 LTS."
  type        = string
  default     = "ubuntu_22_04"
}

variable "instance_name" {
  description = "Name of the Lightsail instance."
  type        = string
  default     = "shiba"
}

variable "tidb_database" {
  description = "Database (schema) name SHIBA uses inside the cluster."
  type        = string
  default     = "shiba"
}

# ---------------------------------------------------------------------------
# TiDB Cloud — the cluster is created MANUALLY in the console (NOT by Terraform;
# see main.tf / README). Pass its Connect-dialog connection details here.
# ---------------------------------------------------------------------------
variable "tidb_host" {
  description = "TiDB cluster host (Connect dialog), e.g. gateway01.ap-northeast-1.prod.aws.tidbcloud.com."
  type        = string
  default     = ""
}

variable "tidb_user" {
  description = "TiDB SQL user: <user_prefix>.root."
  type        = string
  default     = ""
}

variable "tidb_port" {
  description = "TiDB port."
  type        = number
  default     = 4000
}

variable "tidb_password" {
  description = "TiDB SQL password (Connect dialog -> Generate/Reset password). May be empty on the first apply; the box skips 'docker compose up' until it is present, then re-apply."
  type        = string
  sensitive   = true
  default     = ""
}

# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------
variable "ssh_public_key" {
  description = "Contents of your SSH public key (e.g. file contents of ~/.ssh/id_ed25519.pub). Used for admin SSH only."
  type        = string
}

variable "admin_ssh_cidr" {
  description = "CIDR allowed to reach SSH (port 22). Lock to your IP, e.g. 203.0.113.4/32. Telegram uses long polling, so NO inbound app port is opened."
  type        = string
}

variable "shiba_repo_url" {
  description = "Git URL of the SHIBA app to clone and run on the instance."
  type        = string
  default     = "https://github.com/takaya-okamoto/SHIBA.git"
}

variable "github_repo_token" {
  description = "GitHub PAT (fine-grained, read-only Contents on the SHIBA repo) to clone a PRIVATE repo on the box. Leave empty if the repo is public. NOTE: lands in tfstate + instance metadata."
  type        = string
  sensitive   = true
  default     = ""
}

variable "memory_git_remote" {
  description = "Optional. Private GitHub repo for offsite memory backup, e.g. git@github.com:you/shiba-memory.git."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Secrets — supply via terraform.tfvars (gitignored) or env TF_VAR_*.
# These end up in tfstate and in Lightsail user_data; keep state private (see README).
# ---------------------------------------------------------------------------
variable "telegram_bot_token" {
  description = "Bot token from @BotFather. There is NO Terraform for Telegram — create the bot manually first."
  type        = string
  sensitive   = true
}

variable "model_provider" {
  description = "LLM provider: 'bedrock' (Amazon Bedrock via IAM user access keys) or 'anthropic' (Anthropic API key)."
  type        = string
  default     = "bedrock"
  validation {
    condition     = contains(["bedrock", "anthropic"], var.model_provider)
    error_message = "model_provider must be 'bedrock' or 'anthropic'."
  }
}

variable "anthropic_api_key" {
  description = "Anthropic API key. Only needed when model_provider = \"anthropic\"; leave empty for Bedrock."
  type        = string
  sensitive   = true
  default     = ""
}

# Bedrock auth = IAM user access keys. Keyless (the instance assuming an IAM role via IMDS)
# is NOT possible on a plain Lightsail instance: its IMDS identity is the AWS-account-owned
# AmazonLightsailInstanceRole, which we cannot grant cross-account AssumeRole on (see LEARNINGS).
# Create an IAM user with bedrock:InvokeModel[WithResponseStream] and paste its keys here.
variable "aws_access_key_id" {
  description = "IAM user access key id for runtime Bedrock (model_provider=bedrock). Written to the box's .env; the app's AnthropicBedrock SDK reads it from the environment."
  type        = string
  sensitive   = true
  default     = ""
}

variable "aws_secret_access_key" {
  description = "IAM user secret access key for runtime Bedrock (model_provider=bedrock). Written to the box's .env."
  type        = string
  sensitive   = true
  default     = ""
}

variable "bedrock_response_model" {
  description = "Bedrock inference-profile id for responses. Tokyo uses the jp. prefix, e.g. jp.anthropic.claude-sonnet-4-5-20250929-v1:0. Required when model_provider = \"bedrock\". Claude 4.x needs an inference profile (on-demand unsupported); confirm real ids via `aws bedrock list-inference-profiles`."
  type        = string
  default     = ""
}

variable "bedrock_extract_model" {
  description = "Bedrock inference-profile id for extraction (a lighter Haiku jp. profile). Required when model_provider = \"bedrock\"."
  type        = string
  default     = ""
}

variable "gemini_api_key" {
  description = "Google Gemini API key — ONLY if you switch embedding to Gemini (BYOK). Empty = use the free managed Titan model (default), no key needed."
  type        = string
  sensitive   = true
  default     = ""
}
