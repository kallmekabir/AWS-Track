# AWS infrastructure rules

These rules apply to every AWS action in this repo. Detailed procedures live in
docs/infra/RUNBOOK.md; when running the infra runbook, follow its agent loop and
autonomy policy (section 1.3).

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
- Prefer CDK; use direct API calls only for Connect setup, Bedrock account settings, or
  what CloudFormation can't do.
- Infra owns infra/, scripts/, docs/infra/. Never overwrite a teammate's file in lambdas/
  or web/; create stubs only where handler.py is missing.
