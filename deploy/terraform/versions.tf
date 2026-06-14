# SHIBA infrastructure — provider/version constraints.
# Only AWS (Lightsail VPS) is managed by Terraform. The TiDB Cloud Starter cluster is
# created manually in the console (see README) and passed in via the tidb_* variables.
terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60"
    }
  }
}
