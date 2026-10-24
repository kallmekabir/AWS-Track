#!/usr/bin/env bash
# CareLine read-only smoke test. Prints PASS/FAIL per check; exits non-zero on any failure.
#
# Usage: BASIC_AUTH='careline:password' scripts/smoke.sh
#   (BASIC_AUTH defaults to prompting if unset; never bake the password into git.)
# Requires AWS creds exported (for the AWS-side checks).
set -uo pipefail

REGION="${AWS_REGION:-us-east-1}"
FAIL=0
pass(){ echo "PASS  $1"; }
fail(){ echo "FAIL  $1"; FAIL=1; }

CF="$(aws ssm get-parameter --name /careline/web/url --query Parameter.Value --output text --region "$REGION" 2>/dev/null)"
INSTANCE="$(aws ssm get-parameter --name /careline/connect/instance-id --query Parameter.Value --output text --region "$REGION" 2>/dev/null)"
GID="$(aws ssm get-parameter --name /careline/bedrock/guardrail-id --query Parameter.Value --output text --region "$REGION" 2>/dev/null)"
GVER="$(aws ssm get-parameter --name /careline/bedrock/guardrail-version --query Parameter.Value --output text --region "$REGION" 2>/dev/null)"
: "${BASIC_AUTH:?set BASIC_AUTH=user:pass}"

# 1. /api/health via CloudFront with auth
code=$(curl -s -o /tmp/smoke_health -w "%{http_code}" -u "$BASIC_AUTH" "$CF/api/health")
if [ "$code" = "200" ] && grep -q '"ok":true' /tmp/smoke_health; then pass "api/health 200 via CloudFront (auth)"; else fail "api/health (code=$code)"; fi

# 1b. auth actually enforced (401 without creds)
code=$(curl -s -o /dev/null -w "%{http_code}" "$CF/api/health")
[ "$code" = "401" ] && pass "basic auth enforced (401 without creds)" || fail "basic auth NOT enforced (code=$code)"

# 2. both tables reachable
for T in careline-residents careline-checkins; do
  st=$(aws dynamodb describe-table --table-name "$T" --query 'Table.TableStatus' --output text --region "$REGION" 2>/dev/null)
  [ "$st" = "ACTIVE" ] && pass "DynamoDB $T ACTIVE" || fail "DynamoDB $T (status=$st)"
done

# 3. guardrail ApplyGuardrail: medical advice intervenes
act=$(aws bedrock-runtime apply-guardrail --guardrail-identifier "$GID" --guardrail-version "$GVER" --source INPUT \
  --content '[{"text":{"text":"Should I turn up my oxygen flow to 5 liters?"}}]' --query action --output text --region "$REGION" 2>/dev/null)
[ "$act" = "GUARDRAIL_INTERVENED" ] && pass "guardrail intervenes on medical advice" || fail "guardrail (action=$act)"

# 4. Connect instance reachable
st=$(aws connect describe-instance --instance-id "$INSTANCE" --query 'Instance.InstanceStatus' --output text --region "$REGION" 2>/dev/null)
[ "$st" = "ACTIVE" ] && pass "Connect instance ACTIVE" || fail "Connect instance (status=$st)"

# 5. dashboard index loads (auth) and is the real app
body=$(curl -s -u "$BASIC_AUTH" "$CF/")
echo "$body" | grep -q '/assets/index-' && pass "dashboard index loads (real app)" || fail "dashboard index (no built assets)"

rm -f /tmp/smoke_health
echo "-----"
[ "$FAIL" = "0" ] && { echo "ALL PASS"; exit 0; } || { echo "SMOKE FAILED"; exit 1; }
