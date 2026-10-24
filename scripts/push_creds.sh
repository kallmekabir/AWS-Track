#!/usr/bin/env bash
# Push the CURRENT CLI session credentials to the CareLine core instance.
# The instance has no IAM role (workshop restriction), so the backend reads a
# temporary credentials file at /etc/careline/credentials. Those creds expire;
# re-run this script to refresh them. Credentials are never written to the repo.
#
# Usage: scripts/push_creds.sh
# Requires: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN exported,
#           and SSM param /careline/compute/instance-id set by the compute deploy.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
INSTANCE_ID="$(aws ssm get-parameter --name /careline/compute/instance-id --query Parameter.Value --output text --region "$REGION")"
AZ="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].Placement.AvailabilityZone' --output text --region "$REGION")"

: "${AWS_ACCESS_KEY_ID:?export your session creds first}"
: "${AWS_SECRET_ACCESS_KEY:?export your session creds first}"

# Build the credentials file content (AWS shared-credentials format).
CREDS_CONTENT="$(cat <<EOF
[default]
aws_access_key_id = ${AWS_ACCESS_KEY_ID}
aws_secret_access_key = ${AWS_SECRET_ACCESS_KEY}
aws_session_token = ${AWS_SESSION_TOKEN:-}
region = ${REGION}
EOF
)"

# Ephemeral SSH keypair for EC2 Instance Connect (60s validity window).
TMPKEY="$(mktemp -u)"
ssh-keygen -t ed25519 -N "" -f "$TMPKEY" -q
trap 'rm -f "$TMPKEY" "$TMPKEY.pub"' EXIT

aws ec2-instance-connect send-ssh-public-key \
  --instance-id "$INSTANCE_ID" \
  --availability-zone "$AZ" \
  --instance-os-user ec2-user \
  --ssh-public-key "file://$TMPKEY.pub" \
  --region "$REGION" >/dev/null

HOST="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].PublicDnsName' --output text --region "$REGION")"

# Write the creds file as root via sudo, then restart the service.
printf '%s' "$CREDS_CONTENT" | ssh -o StrictHostKeyChecking=no -o ConnectTimeout=20 -i "$TMPKEY" ec2-user@"$HOST" \
  'sudo install -m 0600 -o careline -g careline /dev/stdin /etc/careline/credentials && sudo systemctl restart careline-core && echo pushed'

# Report expiry if these are STS session creds.
EXP="$(aws sts get-caller-identity >/dev/null 2>&1 && aws configure get aws_session_expiration 2>/dev/null || true)"
echo "Credentials pushed to ${INSTANCE_ID} (${HOST}). Service restarted."
echo "Note: temporary session credentials expire; re-run this script to refresh them."
