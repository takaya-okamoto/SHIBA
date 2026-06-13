# ===========================================================================
# Option B — keyless Bedrock for the Lightsail instance (role-chaining).
#
# Lightsail instances run under the service identity
#   arn:aws:sts::<acct>:assumed-role/AmazonLightsailInstance/<instance-id>
# exposed via IMDS. We create a role the instance assumes (chaining), mirroring
# the AWS OpenClaw blueprint's setup-lightsail-openclaw-bedrock-role.sh.
#
# This file (the IAM role + policy) is standard and correct. What still needs a
# one-time spike (see README "Option B"): that a *plain* Ubuntu Lightsail
# instance's IMDS exposes an assumable base identity. If it doesn't, set
# model_provider = "anthropic" and use an API key instead.
# ===========================================================================
data "aws_caller_identity" "current" {}

resource "aws_iam_role" "bedrock" {
  count = var.model_provider == "bedrock" ? 1 : 0
  name  = "${var.instance_name}-bedrock"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        # Per-instance Lightsail service identity. "*" = any Lightsail instance in
        # this account; tighten to the specific i-... after the spike confirms it.
        AWS = "arn:aws:sts::${data.aws_caller_identity.current.account_id}:assumed-role/AmazonLightsailInstance/*"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "bedrock" {
  count = var.model_provider == "bedrock" ? 1 : 0
  name  = "bedrock-invoke"
  role  = aws_iam_role.bedrock[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "BedrockInvoke"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = "*"
      },
      {
        # Lets Bedrock auto-subscribe Anthropic (Marketplace) models on first use.
        Sid      = "MarketplaceForThirdPartyModels"
        Effect   = "Allow"
        Action   = ["aws-marketplace:Subscribe", "aws-marketplace:Unsubscribe", "aws-marketplace:ViewSubscriptions"]
        Resource = "*"
      }
    ]
  })
}
