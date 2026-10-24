# CareCall workshop infrastructure runbook

Updated Oct 24, 2026. Use the existing EC2/CloudFront hosting and two-table
contract. The [original serverless runbook](../docs/reference/infra-runbook.original.md)
is historical and must not be resumed from its first TODO. Its execution-role,
workflow, API Gateway, Knowledge Base and Lambda packaging tasks are superseded.

## Before changing infrastructure

This document update does not deploy application code or change AWS resources.
For an authorized infrastructure task, read:

| Source | Purpose |
| --- | --- |
| [infra/STATE.md](STATE.md) | Recorded resources, decisions, evidence and blockers; preserve historical reports |
| [Hosting handoff](../docs/infra/HANDOFF.md) | Existing deployment, logs, runtime configuration and operations |
| [Resource outputs](../docs/infra-outputs.md) | Recorded IDs and configuration locations |
| [Implementation plan](../docs/careline-plan.md) | Current application architecture |
| [Connect setup](../connect/SETUP.md) | Published bot/flow requirements and acceptance |
| [Task graph](../.plans/careline-task-graph.md) | Current data/API contracts and dependencies |
| [AGENTS.md](../AGENTS.md) | AWS tooling and secret-safety instructions |

Recorded inventory is not a fresh availability check. Confirm account and
us-east-1 before an authorized AWS action; adopt existing resources. Preserve
`careline-` names and Project=careline ownership tags. Prefer the AWS MCP server;
use CLI only when unavailable and after checking the target account. Follow the
applicable AWS skill and verify unfamiliar API details against documentation.

## Constraints

- IAM role creation is denied. WSParticipantRole trusts no AWS service. Do not
  bootstrap CDK, create execution roles, deploy the archived template, or resume
  blocked Lambda/Step Functions/API Gateway/Knowledge Base tasks.
- Connect and Lex use service-linked roles. Reuse the working instance and
  consenting teammate numbers; no campaigns, invocation blocks or recording.
- Himanshu owns EC2/CloudFront and creates two tables: Residents PK id and
  Checkins PK resident_id, SK at. Names come from runtime env. The old five-table
  contract and workflow event/task-token APIs are retired.
- Do not overwrite application files with infrastructure-generated stubs.
  Coordinate changes through backend/app and web's existing contracts.
- Do not delete/release resources, change resources outside the infra ownership
  boundary, or modify IAM as part of routine application deployment. Preserve
  the handoff's teardown approval gate. Never run teardown as a verification step.
- Credential operations follow AGENTS.md and the existing handoff. This plan
  introduces no new credential handling, authentication or secret storage.

## Application deployment contract

1. Install only `backend/requirements.txt` for runtime. Load the keys from
   `backend/.env.example` through `/etc/careline/backend.env`.
2. Start one process from backend/: `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
   The service manager loads the environment file; alternatively use uvicorn's
   `--env-file /etc/careline/backend.env`. Keep one worker so call checking and
   the line limit share a process.
3. CloudFront sends `/api/...` to EC2:8000 and strips `/api`. Forward query strings
   and API write methods; disable caching on the API behavior. Preserve the
   existing hosting access controls recorded in the handoff.
4. Set RESIDENTS_TABLE and CHECKINS_TABLE, Connect settings, and comma-separated
   ALLOWED_ORIGINS with the CloudFront URL and http://localhost:5173.
5. Build web/ with VITE_API_URL=https://<cloudfront>/api; localhost:8000 is the
   default. A URL change requires a rebuild.
6. Deploy only within the authorized task. Paths to scripts in historical reports
   are not proof that those scripts exist in this checkout; use the handoff and
   inspect the working deployment procedure before executing it.

## Verify the current application

- `/api/health` through CloudFront reaches `/health` in the app. Confirm CORS for
  both configured origins and that CloudFront serves fresh `/queue` results.
- Check that the deployed commit includes the lifespan checker. It calls
  `check_calls(force=True)` every five seconds, even with no dashboard open.
- Connect DescribeContact's disconnect timestamp ends a call, with a 300-second
  backstop measured from call_started_at. GetContactAttributes supplies the
  answers; failures should be retried by later checks.
- Inspect one saved transcript and check-in. The guarded transition saves each
  contact once, then dial_next refills lines. There are no task tokens or
  per-turn answer updates.
- Start with CONNECT_DRY_RUN=1 and synthetic residents with allow_call=true.
  Four fake contacts must finish as PERSON_CHECK with five answers each in
  GET /queue. This verifies the application path, not the Lex console or phones.
- Complete the Lex/phone matrix in connect/SETUP.md before switching a hosted
  demo to real calls. Retain the handoff's owner confirmation for that switch.
  The selected bot repeats the safety question for A1; emergency phrases in
  slots escalate after disconnect; early hang-up can bypass attribute copying.

Record actual deployment and verification evidence in STATE.md and outputs only
when performed. Do not change historical reports to imply the new collector or
Phase 2 Bedrock integration has already been deployed or tested on phones.
