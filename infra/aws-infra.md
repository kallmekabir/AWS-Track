# AWS infrastructure rules

These rules apply to every AWS action in this repo. Detailed procedures live in
infra/RUNBOOK.md; when running the infra runbook, follow its current two-table
EC2/CloudFront contract and the recorded hosting handoff.
The original serverless runbook is historical, not an executable task queue.

- Region us-east-1 only. Name resources with the `careline-` prefix (stacks `CareLine*`)
  and tag them `Project=careline`, `Owner=infra`, `Env=hackathon`.
- Read-only calls, `cdk synth/diff/deploy` of CareLine stacks, and creating or updating
  CareLine-tagged resources are allowed without asking.
- Ask the human before deleting or releasing anything, touching resources that are not
  tagged `Project=careline`, or changing IAM outside CareLine roles.
- Never create IAM users or access keys, never write secrets to files or git, never make
  anything public except the CloudFront-served dashboard.
- Record every created resource in docs/infra-outputs.md and SSM under `/careline/`.
- Least-privilege IAM: no `*` resources on Bedrock, DynamoDB or Connect actions.
- Prefer infrastructure-as-code for supported changes, but create no IAM execution
  roles and do not bootstrap CDK or deploy the archived SAM template in this workshop
  account. Reuse the existing EC2, CloudFront and two-table DynamoDB hosting.
- Infra owns infra/, infra scripts and docs/infra/. Application code lives in
  backend/app/ and web/; do not replace teammate code with stubs or create new
  Lambda handlers from the historical plans.
