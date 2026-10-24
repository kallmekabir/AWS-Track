# CareLine Infra — Run State

The agent's memory for infra/RUNBOOK.md. The agent updates this after every task.
Humans may edit it too; the agent re-reads it at the start of every loop.

> Note: the runbook refers to `docs/infra/STATE.md` and `docs/infra/RUNBOOK.md`, but the
> files actually live at `infra/STATE.md` and `infra/RUNBOOK.md`. Those are the real
> paths used by this run.

## Current architecture clarification (Oct 24)

The timestamped tables and reports below are preserved as historical evidence.
Current implementation contracts are in [the workshop task graph](../.plans/careline-task-graph.md)
and [implementation plan](../docs/careline-plan.md): two tables (Residents PK id;
Checkins PK resident_id, SK at), one EC2 uvicorn process, CloudFront /api stripping,
Lex slots without code hooks, and background collection after disconnect. The
old C4/C5/C8 five-table/event contracts and per-turn lex_hook redaction assumption
are retired. The template reference is now docs/reference/template.lambda.yaml.

Local collector tests and DRY_RUN passed; console/phone acceptance and verification
of the deployed collector remain pending. This documentation reconciliation neither
deploys code nor changes the status of any past AWS check. For current operations,
use infra/RUNBOOK.md and docs/infra/HANDOFF.md.

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
| H2 Data+Bedrock logging+Guardrail | DONE | 2 | 21:20 | 21:45 | artifacts bucket careline-artifacts-874092763686 (private, SSE, Bedrock bucket policy); Bedrock S3 logging on (verified); guardrail bathrr9vaolx v2 - medical denials + charging-pass verified; PII note below. Tables still HELD. |
| H3 CareLineCompute (EC2) | DONE | 1 | 21:20 | 21:38 | Stack deployed; i-025ac542a085a7bf0, DNS ec2-34-207-186-236, SG sg-088b86a295fca275b; service active; local /health ok |
| H4 CareLineWeb (S3+CloudFront) | DONE | 1 | 21:20 | 21:42 | d1baurlz014iv6.cloudfront.net; bucket careline-web-874092763686; dist E36C3FDSEFOK86; strip-api function; placeholder uploaded |
| H5 Scripts (push_creds/deploy_core/deploy_web) | DONE | 1 | 21:20 | 21:30 | 3 scripts written + chmod +x; push_creds used successfully to seed creds + ALLOWED_ORIGINS |
| H6 Verify end-to-end | DONE | 1 | 21:46 | 21:47 | /api/health 200 {"ok":true,"calls_dry_run":true}; root placeholder 200; direct EC2:8000 UNREACHABLE (HTTP 000) |
| Git: branch infra/aws-hosting + rebase main | DONE | 1 | 21:16 | 21:18 | Committed infra/docs; rebased on origin/main (pulled backend/, python3.13 SAM app); resolved tech.md conflict keeping both upstream + my edits |
| DynamoDB check (step 4) | DONE | 1 | 21:19 | 21:20 | list-tables = EMPTY. Kabir created none. Contract per backend/template.yaml: Residents PK id(S); Checkins PK resident_id(S) SK at(S); both PAY_PER_REQUEST. HOLDING creation per human. |
| CareLineData tables | DONE | 1 | 21:58 | 22:02 | Team confirmed two-table schema. CFN stack CareLineData: careline-residents (PK id), careline-checkins (PK resident_id, SK at, TTL expires_at), on-demand, PITR off, DeletionPolicy Delete. Both ACTIVE; put/get/delete verified. App switched to DynamoDB (/residents = [] via CloudFront). SSM /careline/tables/* written. |
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
| 22:02 | Two-table schema from backend/template.yaml (Kabir's working backend) SUPERSEDES the C4 section of `.plans/careline-task-graph.md` (Darren's 5-table contract), retired for now. `.plans/careline-task-graph.md` now exists on main (clone was stale; pulled). Tables: careline-residents, careline-checkins. Add more later only if the code needs them. | Team decision. B3 (missing contract) resolved: contract now present but C4 intentionally not followed. |

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

### AWS-hosting phase report (21:47 PDT) — H1-H6 DONE (no-role architecture)
- Live: CloudFront https://d1baurlz014iv6.cloudfront.net -> S3 dashboard (placeholder) + /api/* -> EC2 FastAPI core (backend/app). `/api/health` returns 200 {"ok":true,"calls_dry_run":true}; port 8000 not internet-reachable.
- Resources: EC2 i-025ac542a085a7bf0 (no instance profile, IMDSv2, SG sg-088b86a295fca275b), S3 careline-web + careline-artifacts, CloudFront E36C3FDSEFOK86 + strip-api function, Bedrock guardrail bathrr9vaolx v2, Bedrock S3 invocation logging. All tagged Project=careline. IDs in docs/infra-outputs.md + SSM /careline/*.
- Credentials: temporary WSParticipant session creds pushed to /etc/careline/credentials (mode 0600, approved documented exception). Re-run scripts/push_creds.sh when they expire.
- Guardrail PII limitation: medical-advice denials and grounding work and are verified; however PII ANONYMIZE (and a regex phone filter) do NOT surface via `apply-guardrail --source INPUT` (returns action=NONE, 0 sensitiveInformationPolicyUnits) even with outputScope=FULL. ANONYMIZE applies on the model I/O path, not the standalone INPUT probe. Primary PII control remains the app's regex redaction in lex_hook (per plan; Comprehend step was cut). Recorded as known limitation, not a blocker.
- HELD: DynamoDB tables (awaiting team decision). SKIPPED (no IAM roles): all Lambda/Step Functions/API Gateway/EventBridge-target/Knowledge Base tasks; SAM template.yaml not deployed.

### Hardening phase report (23:05 PDT) — steps 1-9 DONE
- P1.1-P1.4 Connect: adopted Kabir's instance 4ade3c42, flow "CareLine test call" 40ac3787 (TEST only - must switch to real check-in flow; DRY_RUN stays 1 until confirmed), DID stored as SecureString. CONNECT_* in backend.env + SSM /careline/connect/*.
- Step 2 basic auth: CloudFront Functions careline-auth (default) + careline-auth-strip (/api/*, auth+strip). Verified 401 without / 200 with creds on both / and /api/health. Real credential only in deployed functions; repo keeps placeholder.
- Step 3 Bedrock: extract model + guardrail id/v2 in backend.env; Converse from the instance returned OK (instance creds work).
- Step 4 dashboard: web/ built with VITE_API_URL=.../api, deployed to S3+CloudFront; real app loads behind auth; /api/queue + /api/residents polls 200.
- Step 5 deploy_core.sh: tested end to end (pull+pip+restart, service active). Step 6: CloudWatch dashboard "CareLine" (Bedrock/guardrail/DynamoDB/Connect widgets). Step 7: budget careline-hackathon $25, 50/80% to himanshu.jain@sjsu.edu.
- Step 8 smoke.sh: ALL PASS (health+auth, both tables, guardrail intervene, Connect ACTIVE, dashboard). Step 9: docs/infra/HANDOFF.md + scripts/teardown.sh (NOT run; gate G1).
- Note: old careline-strip-api CloudFront Function orphaned (superseded by careline-auth-strip); left in place (delete is gate G1), listed in teardown.sh.
