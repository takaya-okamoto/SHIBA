output "instance_public_ip" {
  description = "Lightsail public IP (for SSH admin only; no app port is exposed)."
  value       = aws_lightsail_instance.shiba.public_ip_address
}

output "ssh_command" {
  description = "SSH in for admin / verification."
  value       = "ssh ${aws_lightsail_instance.shiba.username}@${aws_lightsail_instance.shiba.public_ip_address}"
}

output "tidb_host" {
  value = var.tidb_host
}

output "tidb_user" {
  description = "SQL user (<user_prefix>.root). Cluster is managed outside TF."
  value       = var.tidb_user
}

output "next_steps" {
  value = <<-EOT

    ── Next steps ───────────────────────────────────────────────────────────
    1. If you left tidb_password empty: set it in terraform.tfvars (TiDB Cloud
       console -> Connect -> reset password) and re-run `terraform apply`
       (re-renders .env on the box and starts the app).
    2. SSH to the box:  ${aws_lightsail_instance.shiba.username}@${aws_lightsail_instance.shiba.public_ip_address}
                        cd /opt/shiba/app && sudo docker compose up -d --build
                        sudo docker compose run --rm app node dist/main.js migrate
    3. Message your Telegram bot, then send the one-time owner code from:
                        sudo docker compose logs app | grep "owner setup code"
    ─────────────────────────────────────────────────────────────────────────
  EOT
}
