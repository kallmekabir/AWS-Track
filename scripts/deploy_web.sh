#!/usr/bin/env bash
# Build the dashboard and publish it: npm run build -> s3 sync -> CloudFront invalidation.
#
# Usage: scripts/deploy_web.sh
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
BUCKET="$(aws ssm get-parameter --name /careline/web/bucket --query Parameter.Value --output text --region "$REGION")"
DIST_ID="$(aws ssm get-parameter --name /careline/web/distribution-id --query Parameter.Value --output text --region "$REGION")"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$REPO_ROOT/web"

if [ -f "$WEB_DIR/package.json" ]; then
  ( cd "$WEB_DIR" && npm install && npm run build )
  DIST="$WEB_DIR/dist"
else
  echo "No web/package.json yet; publishing placeholder index.html."
  DIST="$(mktemp -d)"
  cat > "$DIST/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><title>CareLine</title>
<h1>CareLine dashboard deploying</h1>
HTML
fi

aws s3 sync "$DIST" "s3://$BUCKET" --delete --region "$REGION"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' --region "$REGION" >/dev/null
echo "Web deployed to s3://$BUCKET and invalidated distribution $DIST_ID."
