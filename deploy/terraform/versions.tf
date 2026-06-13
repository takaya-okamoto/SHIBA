# SHIBA infrastructure — provider/version constraints.
# Two providers, one `terraform apply`: AWS (Lightsail VPS) + TiDB Cloud (free Starter index).
terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60"
    }
    # PingCAP official provider. `tidbcloud_serverless_cluster` (= Starter tier)
    # is available from v0.4.0. Run `terraform init` then pin to the latest you resolve.
    tidbcloud = {
      source  = "tidbcloud/tidbcloud"
      version = ">= 0.4.0"
    }
  }
}
