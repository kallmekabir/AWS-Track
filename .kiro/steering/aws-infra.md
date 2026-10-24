---
inclusion: always
---

# AWS infrastructure rules

These rules apply to every AWS action taken for CareLine.

- **Region us-east-1 only.** Create no resources in any other region. Tag every resource
  with `Project=careline`.
- **Read-only calls are fine without asking** (describe/list/get/query). Before ANY
  create, update, delete, claim or deploy call, show the exact command and wait for an
  explicit "yes" before running it.
- **Never delete or release a resource** (including releasing phone numbers or deleting
  the Connect instance) unless explicitly asked to in this chat.
- **No long-lived access keys.** Do not write credentials to files and never commit them.
  Use the ambient session credentials; treat any pasted secret as temporary and
  disposable.
- **Record every resource created** in `docs/infra-outputs.md` (name, ID/ARN, purpose)
  and write the matching SSM parameter under `/careline/`.
- **Prefer CDK** for anything CloudFormation supports. Use direct API calls only for
  Amazon Connect setup, Amazon Bedrock settings, or where CloudFormation cannot do it.
