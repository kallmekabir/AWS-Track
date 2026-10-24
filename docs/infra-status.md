# CareLine — AWS readiness check (read-only)

> Historical snapshot from before the IAM restriction and hosting pivot were verified.
> The "No other blockers" conclusion and serverless next steps below are superseded.
> Do not bootstrap CDK or recreate execution-role resources from this report.
> Use [infra/STATE.md](../infra/STATE.md), the [handoff](infra/HANDOFF.md) and the
> [current implementation plan](careline-plan.md). This edit performs no new AWS checks.

Generated: 2026-10-23 (read-only checks only; nothing was created).
Target account confirmed: **`WSParticipantRole` / account `874092763686`**, region
**us-east-1**. Checks run via the AWS CLI with the WSParticipant session credentials.

## Blockers

> **BLOCKER 1 — CDK is not bootstrapped in us-east-1.** The `CDKToolkit` stack does not
> exist on account 874092763686, so `cdk deploy` will fail until `cdk bootstrap` is run.
> This is a create action and needs your explicit "yes".

No other blockers. All required Bedrock models (including Claude Sonnet) are usable, and
every service lists cleanly with no SCP/permission blocks.

> Note on tooling: the **AWS MCP server** authenticates as a different principal
> (`sentry-deployer` / account 972067303232) and cannot reach the target account. All
> CareLine AWS work therefore goes through the shell/CLI path with the WSParticipant
> session credentials passed inline (never written to disk). The session token is
> temporary and will need refreshing when it expires.

## Results

| # | Check | Result | Blocker? | Next step |
| --- | --- | --- | --- | --- |
| 1 | Caller identity / account / region | `arn:aws:sts::874092763686:assumed-role/WSParticipantRole/Participant`, account `874092763686`, us-east-1. **Correct target.** | No | — |
| 2a | Amazon Connect — list instances | `ListInstances` OK, **0 instances**. | No | Create `careline-demo` in the console (needs "yes"). |
| 2b | Connect quota — phone numbers per instance | **5** | No | Claim 1 DID; enough for the demo. |
| 2c | Connect quota — concurrent active calls per instance | **10** | No | CallWave `MaxConcurrency=3` stays well under. |
| 3a | Bedrock — foundation models present | OK. Claude Haiku 4.5, Sonnet 4.5/4.6, Nova Lite/Pro, Titan Embed Text v2 all listed. | No | — |
| 3b | Converse probe — Claude **Haiku 4.5** | **OK** (replied "OK"). | No | `BEDROCK_EXTRACT_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0`. |
| 3c | Converse probe — Claude **Sonnet 4.5** | **OK** (replied "OK"). | No | `BEDROCK_COPILOT_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0`. |
| 3d | Converse probe — **Nova Lite** (fallback) | **OK**. | No | Copilot fallback `us.amazon.nova-lite-v1:0`. |
| 3e | Converse probe — **Nova Pro** (fallback) | **OK**. | No | Copilot fallback `us.amazon.nova-pro-v1:0`. |
| 3f | **Titan Text Embeddings V2** probe | **OK** (`InvokeModel` returned an embedding). | No | KB embeddings `amazon.titan-embed-text-v2:0`. |
| 4a | Lex V2 — list bots | OK, 0 bots. | No | Create `CareLineCheckIn` in the console. |
| 4b | Step Functions — list state machines | OK, 0. | No | Created by CDK (`CareLineCore`). |
| 4c | EventBridge — list buses | OK, 1 (default). | No | Design uses the default bus. |
| 4d | DynamoDB — list tables | OK, **0 tables** (clean). | No | No name collisions; CDK creates the four tables. |
| 4e | S3 Vectors — list vector buckets | OK, 0. | No | Create the KB vector bucket later (needs "yes"). |
| 4f | Amplify — list apps | OK, 0 apps (clean). | No | Create the CareLine frontend app later. |
| 5 | CDK bootstrap (`CDKToolkit`) | **Not present.** | **Yes (B1)** | Run `cdk bootstrap aws://874092763686/us-east-1` (create — needs "yes"). |
| 6 | Budgets | OK, **no budgets configured**. | No | Create a $25 budget alert (needs "yes"). |

## Confirmed model IDs

| Role | Env var | Value | Status |
| --- | --- | --- | --- |
| Extraction (job 1) | `BEDROCK_EXTRACT_MODEL_ID` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Working |
| Copilot (job 2) | `BEDROCK_COPILOT_MODEL_ID` | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | Working |
| Copilot fallback | — | `us.amazon.nova-pro-v1:0` / `us.amazon.nova-lite-v1:0` | Working |
| KB embeddings | — | `amazon.titan-embed-text-v2:0` | Working |

## Notes

- No resources were created, updated, or deleted during this check.
- Billable actions: four tiny `Converse` calls and one `InvokeModel` embeddings call
  (a few tokens each), used to prove model access per request.
- Account 874092763686 is otherwise empty (0 Connect/Lex/SFN/DDB/Amplify/S3-Vectors
  resources), so the CareLine build starts from a clean slate.
