provider "aws" {
  region = var.aws_region
  # Credentials for `terraform apply` itself come from the standard AWS chain
  # (env vars, ~/.aws/credentials, or SSO). The app's RUNTIME Bedrock keys are a
  # separate IAM user (aws_access_key_id / aws_secret_access_key), written to the box's .env.
}
