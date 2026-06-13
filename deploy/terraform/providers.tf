provider "aws" {
  region = var.aws_region
  # Credentials come from the standard AWS chain (env vars, ~/.aws/credentials, or SSO).
}

# TiDB Cloud API key: TiDB Cloud console -> Organization Settings -> API Keys.
# Can also be supplied via env: TIDBCLOUD_PUBLIC_KEY / TIDBCLOUD_PRIVATE_KEY
# (in which case the two arguments below may be omitted).
provider "tidbcloud" {
  public_key  = var.tidb_api_public_key
  private_key = var.tidb_api_private_key
}
