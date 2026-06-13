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

variable "tidb_region_id" {
  description = "TiDB Cloud serverless region id. AWS Tokyo = aws-ap-northeast-1."
  type        = string
  default     = "aws-ap-northeast-1"
}

variable "tidb_cluster_name" {
  description = "Display name of the TiDB Cloud Starter cluster."
  type        = string
  default     = "shiba"
}

variable "tidb_database" {
  description = "Database (schema) name SHIBA uses inside the cluster."
  type        = string
  default     = "shiba"
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
variable "tidb_api_public_key" {
  description = "TiDB Cloud API key (public part)."
  type        = string
  sensitive   = true
}

variable "tidb_api_private_key" {
  description = "TiDB Cloud API key (private part)."
  type        = string
  sensitive   = true
}

variable "telegram_bot_token" {
  description = "Bot token from @BotFather. There is NO Terraform for Telegram — create the bot manually first."
  type        = string
  sensitive   = true
}

variable "model_provider" {
  description = "LLM provider: 'bedrock' (keyless via instance IAM role — option B) or 'anthropic' (API key)."
  type        = string
  default     = "bedrock"
  validation {
    condition     = contains(["bedrock", "anthropic"], var.model_provider)
    error_message = "model_provider must be 'bedrock' or 'anthropic'."
  }
}

variable "anthropic_api_key" {
  description = "Anthropic API key. Only needed when model_provider = \"anthropic\"; leave empty for keyless Bedrock (option B)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "bedrock_response_model" {
  description = "Bedrock model / inference-profile id for responses (region-specific, e.g. apac.anthropic.claude-sonnet-4-...). Required when model_provider = \"bedrock\"."
  type        = string
  default     = ""
}

variable "bedrock_extract_model" {
  description = "Bedrock model / inference-profile id for extraction (e.g. apac.anthropic.claude-haiku-...). Required when model_provider = \"bedrock\"."
  type        = string
  default     = ""
}

variable "gemini_api_key" {
  description = "Google Gemini API key — ONLY if you switch embedding to Gemini (BYOK). Empty = use the free managed Titan model (default), no key needed."
  type        = string
  sensitive   = true
  default     = ""
}

variable "tidb_password" {
  description = "TiDB SQL password. The tidbcloud provider does NOT set this — leave empty on first apply, reset it in the TiDB Cloud console, then put it here and re-apply. See README 'Gotcha A'."
  type        = string
  sensitive   = true
  default     = ""
}
