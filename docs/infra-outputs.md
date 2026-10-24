# CareLine Infrastructure Outputs

Every resource the infra runbook creates. Never put passwords or API key values here;
reference the Secrets Manager secret name or the API key ID instead.

| Name | Type | ID / ARN / URL | SSM key | Created by task | Notes |
| --- | --- | --- | --- | --- | --- |
| careline account | Account | 874092763686 | /careline/account-id | P0.1 | WSParticipantRole, us-east-1 |
| careline-artifacts-874092763686 | S3 bucket | arn:aws:s3:::careline-artifacts-874092763686 | /careline/artifacts/bucket | H2 | Private, SSE AES256. Holds Bedrock invocation logs under bedrock-logs/ |
| Bedrock invocation logging | Bedrock config | (account-level) s3://careline-artifacts-874092763686/bedrock-logs/ | - | H2 | text on, image/embedding off; bucket policy for bedrock.amazonaws.com w/ aws:SourceAccount |
| careline-guardrail | Bedrock guardrail | bathrr9vaolx (version 2) | /careline/bedrock/guardrail-id, /careline/bedrock/guardrail-version | H2 | Denies medical diagnosis, med/dosage advice, device settings; PII ANONYMIZE + regex phone; grounding 0.75/0.75 |
| extract model | Bedrock model id | us.anthropic.claude-haiku-4-5-20251001-v1:0 | /careline/bedrock/extract-model-id | H2 | Working |
| copilot model | Bedrock model id | us.anthropic.claude-sonnet-4-5-20250929-v1:0 | /careline/bedrock/copilot-model-id | H2 | Working |
| embed model | Bedrock model id | amazon.titan-embed-text-v2:0 | /careline/bedrock/embed-model-id | H2 | Working |
| CareLineCompute | CFN stack | CareLineCompute | - | H3 | EC2 + SG, no IAM |
| careline-core | EC2 instance | i-025ac542a085a7bf0 | /careline/compute/instance-id | H3 | t4g.small, AL2023 arm64, no instance profile, IMDSv2, gp3 20GB enc. DNS ec2-34-207-186-236.compute-1.amazonaws.com; public IP 34.207.186.236 |
| careline-core-sg | Security group | sg-088b86a295fca275b | - | H3 | 8000 from pl-3b927c52 (CloudFront) only; 22 from the operator IP only (see the security group) |
| CareLineWeb | CFN stack | CareLineWeb | - | H4 | S3 + OAC + CloudFront + CF Function |
| careline-web-874092763686 | S3 bucket | arn:aws:s3:::careline-web-874092763686 | /careline/web/bucket | H4 | Private, OAC-only read via CloudFront |
| careline-strip-api | CloudFront Function | careline-strip-api | - | H4 | Strips leading /api on the /api/* viewer-request |
| CareLine CDN | CloudFront distribution | E36C3FDSEFOK86 / d1baurlz014iv6.cloudfront.net | /careline/web/distribution-id, /careline/web/url | H4 | default->S3 (SPA), /api/*->EC2:8000 |
| ALLOWED_ORIGINS | config | https://d1baurlz014iv6.cloudfront.net,http://localhost:5173 | /careline/config/allowed-origins | H4 | Pushed into instance backend.env |

## Scripts
- scripts/push_creds.sh - push current CLI session creds to /etc/careline/credentials (EC2 Instance Connect), restart careline-core
- scripts/deploy_core.sh - git pull + pip install + restart on the instance
- scripts/deploy_web.sh - build web, s3 sync, CloudFront invalidation

## Not deployed (no IAM roles available)
Lambda, Step Functions, API Gateway, EventBridge targets, Bedrock Knowledge Base,
CDK bootstrap, SAM backend/template.yaml. See infra/STATE.md decisions.
