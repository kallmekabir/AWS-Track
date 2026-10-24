#!/usr/bin/env bash
# CareLine teardown - DESTRUCTIVE. Do NOT run without explicit approval (gate G1).
# Deletes ONLY infra-owned resources. Leaves Kabir's Amazon Connect instance,
# flow and phone number untouched (teammate-owned).
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"
ACCT=874092763686

echo "This will DELETE CareLine infra. Ctrl-C now to abort."; sleep 5

# 1. Empty + delete web bucket (CloudFront/S3 stack)
aws s3 rm "s3://careline-web-${ACCT}" --recursive --region "$REGION" || true
aws cloudformation delete-stack --stack-name CareLineWeb --region "$REGION"
aws cloudformation wait stack-delete-complete --stack-name CareLineWeb --region "$REGION" || true

# 2. CloudFront Functions (basic auth) - orphaned after stack delete
for FN in careline-auth careline-auth-strip careline-strip-api; do
  ET=$(aws cloudfront describe-function --name "$FN" --query ETag --output text 2>/dev/null || true)
  [ -n "${ET:-}" ] && aws cloudfront delete-function --name "$FN" --if-match "$ET" || true
done

# 3. Compute stack (EC2 + SG)
aws cloudformation delete-stack --stack-name CareLineCompute --region "$REGION"
aws cloudformation wait stack-delete-complete --stack-name CareLineCompute --region "$REGION" || true

# 4. Data stack (tables)
aws cloudformation delete-stack --stack-name CareLineData --region "$REGION"
aws cloudformation wait stack-delete-complete --stack-name CareLineData --region "$REGION" || true

# 5. Artifacts bucket (Bedrock logs) + disable Bedrock logging
aws bedrock delete-model-invocation-logging-configuration --region "$REGION" || true
aws s3 rm "s3://careline-artifacts-${ACCT}" --recursive --region "$REGION" || true
aws s3api delete-bucket --bucket "careline-artifacts-${ACCT}" --region "$REGION" || true

# 6. Guardrail
GID=$(aws ssm get-parameter --name /careline/bedrock/guardrail-id --query Parameter.Value --output text --region "$REGION" 2>/dev/null || true)
[ -n "${GID:-}" ] && aws bedrock delete-guardrail --guardrail-identifier "$GID" --region "$REGION" || true

# 7. CloudWatch dashboard + budget
aws cloudwatch delete-dashboards --dashboard-names CareLine --region "$REGION" || true
aws budgets delete-budget --account-id "$ACCT" --budget-name careline-hackathon || true

# 8. SSM params
aws ssm get-parameters-by-path --path /careline --recursive --query 'Parameters[].Name' --output text --region "$REGION" \
  | tr '\t' '\n' | while read -r P; do [ -n "$P" ] && aws ssm delete-parameter --name "$P" --region "$REGION" || true; done

echo "Teardown complete. NOTE: Kabir's Connect instance/flow/number were left intact."
