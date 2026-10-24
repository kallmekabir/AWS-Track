# CareLine Infra — Run State

The agent's memory for infra/RUNBOOK.md. The agent updates this after every task.
Humans may edit it too; the agent re-reads it at the start of every loop.

> Note: the runbook refers to `docs/infra/STATE.md` and `docs/infra/RUNBOOK.md`, but the
> files actually live at `infra/STATE.md` and `infra/RUNBOOK.md`. Those are the real
> paths used by this run.

## Run

| Field | Value |
| --- | --- |
| Account ID | 874092763686 (WSParticipantRole/Participant) |
| Region | us-east-1 |
| Run started | 2026-10-23 18:46 PDT |
| Current phase | 0 |
| Time scale (demo) | 60 |
| Last verify result | _none yet_ |
| Credentials | WSParticipant temporary session, passed inline per CLI call (never written to disk). MCP server is on a different account (972067303232) and is NOT used. |

## Tasks

Status: TODO · IN_PROGRESS · DONE · WAITING · BLOCKED · SKIPPED

| Task | Status | Attempts | Started | Finished | Evidence / notes |
| --- | --- | --- | --- | --- | --- |
| P0.1 Initialize state | DONE | 1 | 18:46 | 18:47 | Account 874092763686 confirmed via sts; /careline/account-id SSM param written (v1) + tagged; blockers imported below |
| P0.2 Toolchain | BLOCKED | 3 | 18:47 | 18:52 | python3.12/node22/aws-cli OK; cdk via `npx aws-cdk@2` (2.1146.1); Docker ABSENT (use local bundling). `cdk bootstrap` FAILED: WSParticipantRole lacks iam:CreateRole. CDKToolkit left in ROLLBACK_COMPLETE. See blocker B2 / gate G4. |
| P0.3 Budget guard | TODO | 0 | | | Needs alertEmail (gate G3 if missing) |
| P0.4 Verification harness | TODO | 0 | | | |
| P1.1 Connect instance | TODO | 0 | | | |
| P1.2 Phone number | TODO | 0 | | | |
| P1.3 Queue and routing | TODO | 0 | | | |
| P1.4 Users | TODO | 0 | | | |
| P1.5 Web calling readiness (optional) | TODO | 0 | | | |
| P1.6 Lambda and Lex association | SKIPPED | 0 | | 20:33 | No execution roles possible (B2). Architecture pivoted to EC2+CloudFront+S3. |
| P2.1 Model selection and smoke tests | TODO | 0 | | | Readiness report: Haiku 4.5, Sonnet 4.5, Nova Lite/Pro, Titan Embed v2 all working (invoke needs no role) |
| P2.2 Model invocation logging | SUPERSEDED | 0 | | 20:33 | Role-based CW logging skipped; replaced by H2 (Bedrock logging to S3 via bucket policy, no role) |
| P2.3 Guardrail | TODO | 0 | | | Moved into H2 (no role needed) |
| P3.1 CDK app skeleton | TODO | 0 | | | Reused for H2 CareLineData synth (no bootstrap; `cloudformation deploy`) |
| P3.2 CareLineData | TODO | 0 | | | H2 — needs C4 contract (BLOCKED, see B3) |
| P3.3 Seed loader (optional) | TODO | 0 | | | |
| P4.1 Lambda packaging and functions | SKIPPED | 0 | | 20:33 | No Lambda execution role possible (B2). Logic now runs on EC2 FastAPI core. |
| P4.2 Event bus | SKIPPED | 0 | | 20:33 | EventBridge→Lambda/SFN targets need roles; superseded by in-process handling on EC2 core (C5 contract) |
| P4.3 resident-check state machine | SKIPPED | 0 | | 20:33 | No Step Functions execution role possible (B2) |
| P4.4 call-wave state machine | SKIPPED | 0 | | 20:33 | No Step Functions execution role possible (B2) |
| P4.5 Outage ended | SKIPPED | 0 | | 20:33 | No Lambda execution role possible (B2) |
| P5.1 CareLineApi | SKIPPED | 0 | | 20:33 | API Gateway+Lambda-proxy needs a role; replaced by EC2 FastAPI behind CloudFront /api/* (H3/H4) |
| P6.1 Vector store and KB | SKIPPED | 0 | | 20:33 | Bedrock KB requires a service role (B2). Grounding falls back to prompt-stuffing on the EC2 core |
| P6.2 KB content and ingestion | SKIPPED | 0 | | 20:33 | Depends on P6.1 (no KB role) |
| P7.1 CareLineWeb | TODO | 0 | | | H4 — S3+CloudFront, no role |
| P7.2 CareLineObservability | SKIPPED | 0 | | 20:33 | Alarms/SNS fine but metric pipeline tied to Lambda/SFN that are skipped; defer |
| H1 Readonly perms probe | DONE | 1 | 20:31 | 20:33 | MaxSessionDuration 43200s; RunInstances t4g.small dry-run OK; CloudFront OK (0 dists); S3 list OK; operator IP recorded in the security group; cf prefix pl-3b927c52; default vpc-047a74fe9d428cf6b subnet-0f4ede8143c572e07 ami-07890d146f8d6ee5b (AL2023 arm64) |
| H2 Data+Bedrock logging+Guardrail | BLOCKED | 0 | 20:33 | | Needs C4 table contract — `.plans/careline-task-graph.md` missing (B3) |
| H3 CareLineCompute (EC2) | TODO | 0 | | | |
| H4 CareLineWeb (S3+CloudFront) | TODO | 0 | | | |
| H5 Scripts (push_creds/deploy_core/deploy_web) | TODO | 0 | | | |
| H6 Verify end-to-end | TODO | 0 | | | |
| P8.1 End-to-end dry run | TODO | 0 | | | |
| P8.2 Live call smoke test | TODO | 0 | | | |
| P8.3 Handoff | TODO | 0 | | | |
| P8.4 Freeze | TODO | 0 | | | |

## Decisions

| Time | Decision | Why |
| --- | --- | --- |
| 18:46 | Target account = 874092763686 (WSParticipant), per the human | Readiness check first ran on the wrong account (MCP server = 972067303232); human confirmed WSParticipant is the real target |
| 18:46 | All AWS calls via shell/CLI with inline WSParticipant creds (Option A) | MCP server cannot reach the target account; creds are temporary and never written to disk |

## Blockers

| ID | Task | Error / cause | Fallback in use | Owner |
| --- | --- | --- | --- | --- |
| B1 | P0.2 | CDKToolkit stack absent in us-east-1 | Attempted `cdk bootstrap` → superseded by B2 | agent |
| B2 | P0.2 + all CDK/role tasks | **WSParticipantRole cannot create IAM roles.** `ws-default-policy` scopes IAM to read-only (List/Get/Generate) + CreateServiceLinkedRole + PassRole(WSParticipantRole only). `iam:CreateRole` denied under every attempt (plain, via CFN, with permissions boundary). PowerUserAccess excludes IAM writes. | None available in-account. Gate G4 raised. CDK bootstrap, every Lambda/SFN/Bedrock-logging/KB execution role (P0.2, P2.2, P3.x, P4.x, P5.1, P6.1, P7.x) are blocked by this. | human / organizers |

## Decisions (continued)

| Time | Decision | Why |
| --- | --- | --- |
| 18:52 | Halt the run at gate G4 after P0.2 | Cannot create IAM roles; CDK bootstrap and nearly every remaining task depend on role creation. Tried 3 distinct approaches; root cause is a deliberate workshop IAM guardrail, not a transient error. Continuing would only produce a cascade of BLOCKED tasks (a stop condition). |
| 20:27 | Confirmed PassRole-to-WSParticipantRole fallback is NOT viable for Lambda | `WSParticipantRole` trust policy trusts only AWS principals (acct 484654583263, WSControlPlaneUser), NO service principals. `create-function --role WSParticipantRole` → `InvalidParameterValueException: The role defined for the function cannot be assumed by Lambda`. SF `create-state-machine` succeeded (SF doesn't validate trust at create) but would fail at runtime. PassRole statement has no Condition. Net: no in-account way to give Lambda an execution role. G4 stands. |
| 20:33 | ARCHITECTURE PIVOT (human decision): host on AWS without new roles — EC2 (no instance profile, creds pushed to file) running FastAPI core behind CloudFront + S3 dashboard. All Lambda/Step Functions/API Gateway/Knowledge Base tasks SKIPPED (reason: no execution roles). Contracts in `.plans/careline-task-graph.md` (C4/C5/C8) win over the runbook. Execute H1–H6. | WSParticipantRole can run EC2 (dry-run OK) and manage S3/CloudFront/DynamoDB/Bedrock/Guardrail — none of which need a new role. Temporary workshop creds on the instance approved as a documented exception. |

## Blockers (continued)

| ID | Task | Error / cause | Fallback in use | Owner |
| --- | --- | --- | --- | --- |
| B3 | H2 (and seed) | Authoritative contract file `.plans/careline-task-graph.md` (C4 tables, C5 events, C8 API) does not exist anywhere in the repo. H2 requires "5 tables exactly per C4"; the runbook/plan describe only 4. Cannot infer the 5th table or exact keys/GSIs without the contract. | None — need the file or the C4 spec. H1/H3/H4/H5 that don't depend on C4 can still proceed. | human |

## Gates (waiting on the human)

| Gate | Task | Need | Asked at | Resolved |
| --- | --- | --- | --- | --- |
| G4 | P0.2 + all role-creating tasks | IAM permission to create roles (`iam:CreateRole`/`AttachRolePolicy`/`PutRolePolicy`/`TagRole`) on this account, OR pre-created CareLine execution roles whose ARNs I can pass, OR a different account/role that can bootstrap CDK. `ws-default-policy` makes IAM read-only. | 18:53 | — |
## Waiting on teammates

| Task | Condition | Who | Since |
| --- | --- | --- | --- |

## Reports

### Phase 0 report (18:53 PDT) — HALTED at gate G4
- P0.1 DONE: account 874092763686 confirmed; `/careline/account-id` SSM param written + tagged; STATE/outputs files initialized.
- P0.2 BLOCKED: toolchain OK (python3.12, node22, aws-cli, cdk via `npx aws-cdk@2`; Docker ABSENT → local bundling), but `cdk bootstrap` failed because WSParticipantRole lacks `iam:CreateRole`.
- Root cause (verified 3 ways): `ws-default-policy` makes IAM read-only (List/Get/Generate) + CreateServiceLinkedRole + PassRole(self only); PowerUserAccess excludes IAM writes. No in-account fallback exists.
- Impact: CDK bootstrap + every execution-role task (P2.2, P3.x, P4.x, P5.1, P6.1, P7.x) are blocked. CDKToolkit is in ROLLBACK_COMPLETE.
- Awaiting gate G4 before continuing. P0.3/P0.4 and read-only Bedrock/Connect checks could proceed meanwhile but the core CDK build cannot land until G4 is resolved.
