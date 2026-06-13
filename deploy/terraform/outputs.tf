output "instance_public_ip" {
  description = "Lightsail public IP (for SSH admin only; no app port is exposed)."
  value       = aws_lightsail_instance.shiba.public_ip_address
}

output "ssh_command" {
  description = "SSH in for admin / verification."
  value       = "ssh ${aws_lightsail_instance.shiba.username}@${aws_lightsail_instance.shiba.public_ip_address}"
}

output "tidb_host" {
  value = tidbcloud_serverless_cluster.shiba.endpoints.public.host
}

output "tidb_port" {
  value = tidbcloud_serverless_cluster.shiba.endpoints.public.port
}

output "tidb_user" {
  description = "SQL user. Serverless user is '<user_prefix>.root'."
  value       = "${tidbcloud_serverless_cluster.shiba.user_prefix}.root"
}

output "tidb_cluster_id" {
  value = tidbcloud_serverless_cluster.shiba.cluster_id
}

output "bedrock_role_arn" {
  description = "Role the instance assumes for keyless Bedrock (option B). null when model_provider=anthropic. Used in ~/.aws/config (role_arn) once the IMDS spike passes."
  value       = one(aws_iam_role.bedrock[*].arn)
}

output "next_steps" {
  value = <<-EOT

    ── Next steps ───────────────────────────────────────────────────────────
    1. TiDB password (Gotcha A): the tidbcloud provider does NOT manage the SQL
       password. Open the TiDB Cloud console -> this cluster -> reset password,
       put it in terraform.tfvars as `tidb_password`, then re-run `terraform apply`
       (re-renders .env on the box and starts the app).
    2. Verify on the box:  ${aws_lightsail_instance.shiba.username}@${aws_lightsail_instance.shiba.public_ip_address}
                           cd /opt/shiba/app && docker compose ps && docker compose logs -f
    3. Message your Telegram bot, then send the one-time owner code printed in the logs.
    ─────────────────────────────────────────────────────────────────────────
  EOT
}
