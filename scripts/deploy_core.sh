#!/usr/bin/env bash
# Redeploy the CareLine core on the EC2 instance: git pull + pip install + restart.
# Uses EC2 Instance Connect (same ephemeral-key pattern as push_creds.sh).
#
# Usage: scripts/deploy_core.sh
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
INSTANCE_ID="$(aws ssm get-parameter --name /careline/compute/instance-id --query Parameter.Value --output text --region "$REGION")"
AZ="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].Placement.AvailabilityZone' --output text --region "$REGION")"
HOST="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].PublicDnsName' --output text --region "$REGION")"

TMPKEY="$(mktemp -u)"
ssh-keygen -t ed25519 -N "" -f "$TMPKEY" -q
trap 'rm -f "$TMPKEY" "$TMPKEY.pub"' EXIT

aws ec2-instance-connect send-ssh-public-key \
  --instance-id "$INSTANCE_ID" --availability-zone "$AZ" \
  --instance-os-user ec2-user --ssh-public-key "file://$TMPKEY.pub" --region "$REGION" >/dev/null

ssh -o StrictHostKeyChecking=no -o ConnectTimeout=20 -i "$TMPKEY" ec2-user@"$HOST" bash -s <<'REMOTE'
set -euo pipefail
sudo -u careline git -C /opt/careline pull --ff-only
sudo -u careline /opt/careline/.venv/bin/pip install -r /opt/careline/backend/requirements.txt uvicorn
sudo systemctl restart careline-core
sleep 2
systemctl is-active careline-core && echo "careline-core restarted"
REMOTE

echo "Core redeployed on ${INSTANCE_ID}."
