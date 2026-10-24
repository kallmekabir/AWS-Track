# CareLine Infrastructure Runbook (agent-executable)

**Audience:** the Kiro agent responsible for CareLine's AWS infrastructure.
**Goal:** stand up, verify and hand off every AWS resource CareLine needs, end to end,
with as little human prompting as possible.
**Human owner:** the infra engineer who started this run. Talk to them only at the
gates listed in section 7.

Kickoff instruction the human gives you:

> Read docs/infra/RUNBOOK.md and docs/infra/STATE.md, then execute the runbook from
> the first task that is not DONE. Follow the agent loop exactly. Do not stop to ask
> me anything except at the human gates defined in the runbook.

If your context is reset at any point, re-read this file and `docs/infra/STATE.md` and
resume. **STATE.md is your memory; keep it accurate.**

---

## 1. Operating contract

### 1.1 Scope

- AWS account: the event-provided account the CLI is currently authenticated to.
  Confirm with `sts get-caller-identity` at the start of every session and stop if
  the account ID differs from the one recorded in STATE.md.
- Region: **us-east-1 only.**
- Every resource is named with the prefix `careline-` (or `CareLine` for stacks) and
  tagged `Project=careline`, `Owner=infra`, `Env=hackathon`.
- You own `infra/`, `scripts/` (infra scripts only), `docs/infra/` and
  `.kiro/specs/infra/`. **Teammates own `lambdas/` and `web/`.** You may create a file
  in `lambdas/<name>/` only if that folder has no `handler.py` yet (stubs, section
  6.3). Never overwrite or edit a teammate's existing file.

### 1.2 Sources of truth (read before acting)

| File | Use |
| --- | --- |
| `docs/careline-plan.md` | Product and architecture design. Sections: "Data model", "Voice agent", "Triage, routing and escalation", "Amazon Bedrock: three jobs", "Backend APIs and operator dashboard", "Responsible AI, privacy and audit" |
| `docs/infra-status.md` | Read-only readiness report already produced (account, quotas, model access, blockers) |
| `docs/infra/STATE.md` | Task ledger, decisions, blockers, evidence. Update after every task |
| `docs/infra-outputs.md` | Human-readable list of every resource ID and ARN |
| SSM Parameter Store `/careline/*` | Machine-readable config that Lambdas and teammates read |
| `.kiro/steering/*.md` | Project rules; they apply to every action |

### 1.3 Autonomy policy

| Category | Examples | What you do |
| --- | --- | --- |
| **Act freely** | Any read/list/describe call; `cdk synth`, `cdk diff`; tests; creating or updating resources that carry `Project=careline` in us-east-1; `cdk deploy` of CareLine stacks; writing SSM parameters under `/careline/`; deleting test items **you** wrote into CareLine tables during verification | Do it, record it, move on |
| **Act once, then fall back** | Claiming a phone number; anything with a known quota risk | One attempt. On a limit error, record it and take the documented fallback. Never retry in a loop |
| **Human gate** (section 7) | Deleting or releasing any resource; touching anything not tagged `Project=careline`; IAM changes outside CareLine roles; spend likely to exceed the budget; anything requiring a password, OAuth consent or a payment method | Stop that task, write the gate request in STATE.md, notify the human in one message, continue with tasks that don't depend on it |
| **Never** | Disable CloudTrail or security services; create IAM users or access keys; write secrets to files or git; make anything public except the CloudFront-served dashboard; act in another region | Refuse and record why |

### 1.4 Tools

- **AWS MCP server** for direct API calls (Connect, Bedrock settings, SSM, checks).
- **AWS Documentation MCP** (if connected) whenever you are unsure of an API shape,
  a CloudFormation property or a quota. Look it up; do not guess.
- **CDK CLI** (`cdk synth | diff | deploy`) run from `infra/`.
- **Shell** for Python, pytest, packaging and `scripts/verify_infra.py`.
- **git** for a commit after every DONE task.

---

## 2. The agent loop

Run this loop until every task is DONE, WAITING or BLOCKED, or a stop condition fires.

```
LOOP:
 1. ORIENT   Read STATE.md. Confirm account ID and region. Note current local time.
 2. SELECT   Pick the first task (section 5 order) whose status is TODO and whose
             dependencies are DONE. If none: pick a WAITING task whose wait condition
             is now met. If still none: go to FINISH.
 3. PLAN     Write to STATE.md: task ID, status IN_PROGRESS, start time, a 1-3 line plan.
 4. PRECHECK Read-only calls: does the resource already exist? Is it in the expected
             state? If it exists and matches, ADOPT it (record its ID) instead of creating.
 5. ACT      Make the smallest change that satisfies the task. Prefer CDK for anything
             CloudFormation supports; direct API calls only where the task says so.
 6. VERIFY   Run every check in the task's "Verify" list. Each check must produce
             concrete evidence (an ID, a status string, an HTTP code, a test result).
 7. RECORD   On success: status DONE, evidence lines, outputs to docs/infra-outputs.md
             and SSM, commit "infra(<task-id>): <summary>".
 8. REFLECT  On failure: classify the error (section 4), fix, and retry. Each retry must
             change something (input, approach or permissions); never repeat the same
             call blindly. Max 3 attempts per task. After 3: take the task's Fallback if
             it has one, otherwise mark BLOCKED with the diagnosis and move on.
 9. PHASE GATE  When the last task of a phase is DONE, run `python scripts/verify_infra.py`
             (section 6.1). Every check for completed phases must be green before the next
             phase starts. A red check reopens the task it belongs to.
10. REPORT   At each phase end, append a 5-line report to STATE.md ("Reports") and print
             it to the human. Do not wait for a reply.
11. Go to 1.

FINISH: run the full verify suite, update docs/infra-outputs.md, generate .env.local
(section 6.4), write the final report, and stop.
```

### 2.1 Stop conditions (stop and tell the human)

- The account ID changes, or credentials expire and cannot be refreshed.
- The AWS Budget alert fires, or estimated spend for the run exceeds $20.
- Three tasks in a row end BLOCKED.
- A phase exceeds its time box by more than 50% (section 5 lists time boxes).
- You are about to do something in the "Never" row.

### 2.2 Time awareness

The team's video recording starts at **6:00 AM PT Saturday** and the build gates are
7 PM, 11 PM and 3 AM PT Friday night. Each phase has a target clock time. If you are
behind, finish the current task, then skip tasks marked **(optional)** and say so in
the phase report.

---

## 3. Conventions

### 3.1 Names

| Resource | Name |
| --- | --- |
| CDK stacks | `CareLineData`, `CareLineCore`, `CareLineApi`, `CareLineWeb`, `CareLineObservability` |
| DynamoDB | `careline-residents`, `careline-calls`, `careline-tasks`, `careline-audit` |
| Lambdas | `careline-dialer`, `careline-lex-hook`, `careline-triage-step`, `careline-outage-ended`, `careline-copilot`, `careline-api`, `careline-call-status` |
| State machines | `careline-resident-check`, `careline-call-wave` |
| Event bus | `careline-events` |
| Log groups | `/careline/<component>` (7-day retention) |
| Connect instance alias | `careline-demo` |
| Guardrail | `careline-guardrail` |
| Knowledge Base | `careline-kb` |

### 3.2 SSM parameter tree (String type unless noted)

```
/careline/account-id
/careline/connect/instance-id            /careline/connect/instance-arn
/careline/connect/phone-number           /careline/connect/phone-number-id
/careline/connect/queue-responders-id    /careline/connect/flow-id        (teammate sets)
/careline/connect/web-calling            ("enabled" | "fallback-required")
/careline/lex/bot-alias-arn              (teammate sets)
/careline/bedrock/extract-model-id       /careline/bedrock/copilot-model-id
/careline/bedrock/embed-model-id         /careline/bedrock/fallback-model-id
/careline/bedrock/guardrail-id           /careline/bedrock/guardrail-version
/careline/bedrock/kb-id                  /careline/bedrock/kb-data-source-id
/careline/tables/<name>                  /careline/events/bus-name
/careline/sfn/resident-check-arn         /careline/sfn/call-wave-arn
/careline/api/url                        /careline/api/key-id
/careline/web/url
/careline/config/time-scale              ("1" default, "60" for demos)
/careline/config/dialer-allow-list       (comma-separated E.164; human sets)
```

Lambdas read config from SSM at cold start (Powertools parameters utility), so
teammates can change config without a redeploy.

### 3.3 docs/infra-outputs.md format

One table: `Name | Type | ID / ARN / URL | SSM key | Created by task | Notes`.
Never put passwords or API key values in this file; reference Secrets Manager or the
API key ID instead.

### 3.4 Commits

One commit per DONE task: `infra(P3.2): CareLineData stack deployed (4 tables)`.
Do not commit `cdk.out/`, `.env*` (except `.env.example`) or build artifacts.

---

## 4. Error playbook (use in REFLECT)

| Error signal | Meaning | Action |
| --- | --- | --- |
| `AccessDenied`, `UnauthorizedOperation`, explicit deny in an SCP | Event account restriction | Do not retry the same call. Check docs/infra-status.md; try the documented fallback; else BLOCKED + gate G4 |
| `ThrottlingException`, `TooManyRequests` | Rate limit | Back off 2s, 4s, 8s, then continue |
| `ResourceConflict`, `AlreadyExists`, `DuplicateResource` | Created earlier (maybe by you) | Describe it; ADOPT if it matches, record ID |
| `LimitExceeded` / "allowed limit for claimed phone numbers" | Connect number quota (common on new instances) | **Do not retry.** Set `/careline/connect/web-calling` = `fallback-required`, record, gate G2 (support case), continue |
| Bedrock `AccessDeniedException` on invoke | Model not enabled in this account | Try the next model in the fallback chain (P2.1); record which one works |
| Bedrock `ValidationException` on model ID | Wrong ID or needs an inference profile | List inference profiles; use the `us.` profile ID |
| CloudFormation `ROLLBACK_COMPLETE` / `UPDATE_ROLLBACK_COMPLETE` | Deploy failed | Read the first `*_FAILED` stack event; fix the cause in CDK; redeploy. A stack in `ROLLBACK_COMPLETE` that never succeeded must be deleted before redeploy: that is gate G1 unless the stack is empty |
| CDK "needs bootstrap" / `SSM parameter /cdk-bootstrap/... not found` | Not bootstrapped | Run `cdk bootstrap aws://<account>/us-east-1` (act freely) |
| Docker not available during bundling | Local machine has no Docker | Use the local bundling path (section 6.2); never require Docker |
| Lambda `ImportModuleError` in tests | Packaging problem | Rebuild with `scripts/build_lambdas.sh`; check platform tags (arm64, cp312) |
| Step Functions `States.Timeout` in dry run where none expected | Task token never returned | Check the stub received the token (CloudWatch logs), check IAM `states:SendTaskSuccess` |
| Any error you can't classify | Unknown | Look it up in the AWS Documentation MCP, then decide. Write the diagnosis in STATE.md before retrying |

---

## 5. Phases and tasks

Each task: **Goal · Depends · Steps · Verify · Outputs · Fallback.** Execute in order.

### Phase 0 — Bootstrap the run (target done by 6:45 PM)

**P0.1 Initialize state.**
- Steps: ensure `docs/infra/STATE.md` exists (template is in the repo). Fill account ID,
  region, start time. Import every blocker from `docs/infra-status.md` into the
  Blockers table. Record which Bedrock models and quotas the readiness check found.
- Verify: STATE.md has the account ID and at least one row per phase task.
- Outputs: `/careline/account-id`.

**P0.2 Toolchain.**
- Steps: check `python3.12`, `node`, `cdk --version` (v2), `aws --version`, `docker info`
  (record presence only). Create `infra/requirements.txt` (aws-cdk-lib, constructs,
  pytest) and a venv if missing. Check `CDKToolkit` stack; bootstrap if missing.
- Verify: `cdk --version` prints v2; `CDKToolkit` stack status is `*_COMPLETE`.

**P0.3 Budget guard.**
- Steps: create an AWS Budget `careline-hackathon`, $25/month cost budget, alerts at 50%
  and 80% actual to the email in CDK context `alertEmail` (ask the human only if it is
  missing; gate G3). Use the Budgets API directly.
- Verify: `describe-budget` returns it with 2 notifications.
- Fallback: if Budgets is denied, record BLOCKED and continue (non-critical).

**P0.4 Verification harness.**
- Steps: write `scripts/verify_infra.py` (section 6.1) with the Phase 0 checks only;
  add checks as each phase completes.
- Verify: `python scripts/verify_infra.py` exits 0 and prints the JSON summary.

### Phase 1 — Amazon Connect (target done by 7:15 PM; critical path for the voice teammate)

**P1.1 Instance.**
- Steps: PRECHECK `list-instances` for alias `careline-demo` (adopt if present). Else
  `create-instance` with `IdentityManagementType=CONNECT_MANAGED`,
  `InboundCallsEnabled=true`, `OutboundCallsEnabled=true`, alias `careline-demo`.
  Poll `describe-instance` every 15s until `InstanceStatus=ACTIVE` (max 5 min).
  Set instance attributes `CONTACTFLOW_LOGS=true`; leave call recording off.
- Verify: status ACTIVE; outbound enabled.
- Outputs: instance ID and ARN → SSM + outputs file; admin console URL
  `https://careline-demo.my.connect.aws/` in the outputs file.

**P1.2 Phone number (act once, then fall back).**
- Steps: `search-available-phone-numbers` (TargetArn = instance ARN, country US, type
  DID, max 5). Claim the first with `claim-phone-number`. Poll `describe-phone-number`
  until status CLAIMED.
- Verify: number status CLAIMED and associated to the instance.
- Fallback: on any limit/quota error, do not retry. Set `/careline/connect/web-calling`
  = `fallback-required`, open gate G2 (the human opens a support case or asks
  organizers), and notify the voice teammate via the phase report. Continue.

**P1.3 Queue and routing.**
- Steps: list hours of operation; use "Basic Hours" (create a 24/7 one,
  `careline-24x7`, if Basic Hours isn't 24/7). Create queue `Responders`. Create
  routing profile `careline-operators` (voice, concurrency 1) with `Responders` and
  `BasicQueue` associated. If a number was claimed, set it as the queue's outbound
  caller ID.
- Verify: queue and routing profile exist and are linked.
- Outputs: queue ID → `/careline/connect/queue-responders-id`.

**P1.4 Users.**
- Steps: create users `careline-admin` (Admin security profile) and `careline-operator`
  (Agent security profile, routing profile `careline-operators`, softphone). Generate a
  strong random password for each and store it **only** in Secrets Manager
  `careline/connect/<username>` (tagged). Never print or commit it.
- Verify: `describe-user` for both; secrets exist.
- Outputs: usernames and secret names in the outputs file.

**P1.5 Web calling readiness (optional unless P1.2 fell back).**
- Steps: web calling needs a communications widget created in the Connect admin
  website. You cannot fully do it by API: write the exact click path into
  `docs/infra/HANDOFF.md` for the voice teammate, and make sure the instance and
  flow IDs it needs are in SSM.
- Verify: HANDOFF.md section exists.

**P1.6 Lambda and Lex association (WAITING allowed).**
- Depends: P4.1 (Lambdas exist). For Lex: `/careline/lex/bot-alias-arn` set by teammate.
- Steps: `associate-lambda-function` for `careline-dialer`-related flow Lambdas
  (`careline-lex-hook`, `careline-call-status`). When the bot alias ARN appears in SSM,
  `associate-bot` (LexV2Bot AliasArn) and add the Lex resource policy that lets Connect
  invoke it. If the parameter is missing, mark WAITING with condition
  "SSM /careline/lex/bot-alias-arn exists" and move on; re-check each loop.
- Verify: `list-lambda-functions` and `list-bots --lex-version V2` on the instance show them.

### Phase 2 — Bedrock (target done by 7:45 PM)

**P2.1 Model selection and smoke tests.**
- Steps: from docs/infra-status.md and `list-inference-profiles`, choose:
  - extraction: newest Claude Haiku profile (`us.` prefix);
  - copilot: newest Claude Sonnet profile;
  - fallback chain for both: Amazon Nova Pro, then Nova Lite;
  - embeddings: Titan Text Embeddings V2.
  For each chosen model, one Converse call: system "Reply with OK only.", user "ping",
  maxTokens 5. For embeddings, one InvokeModel with a short string. Record latency.
- Verify: every chosen model returned a response; latencies recorded in STATE.md.
- Outputs: `/careline/bedrock/{extract,copilot,embed,fallback}-model-id`.
- Fallback: if no Claude model works, use Nova for both and note it in the phase
  report (the app still passes the Bedrock gate).

**P2.2 Model invocation logging.**
- Steps: create log group `/careline/bedrock` (7-day retention) and an IAM role that
  Bedrock can assume (`bedrock.amazonaws.com`, condition on this account) with
  `logs:CreateLogStream` and `logs:PutLogEvents` on that group only.
  `put-model-invocation-logging-configuration` with CloudWatch delivery, text data on,
  image and embedding data off.
- Verify: `get-model-invocation-logging-configuration` matches; make one Converse call
  and confirm a log event appears within 2 minutes.

**P2.3 Guardrail.**
- Steps: `create-guardrail` named `careline-guardrail`:
  - Denied topics (type DENY), each with 3 example phrases:
    1. *Medical diagnosis*: deciding what condition someone has.
    2. *Medication or dosage advice*: changing doses, flow rates or schedules.
    3. *Device settings*: changing settings on ventilators, oxygen concentrators,
       dialysis or infusion equipment.
  - PII: ANONYMIZE for NAME, PHONE, ADDRESS, EMAIL.
  - Contextual grounding filters: GROUNDING 0.75, RELEVANCE 0.75.
  - Blocked input and output message: "I can't advise on that. I'm connecting you with
    a responder."
  Then `create-guardrail-version`.
- Verify with `apply-guardrail` (source INPUT, no model needed):
  - "Should I turn up my oxygen flow to 5 liters?" → `GUARDRAIL_INTERVENED`.
  - "Can I double my insulin tonight?" → `GUARDRAIL_INTERVENED`.
  - "Where is the nearest charging center?" → `NONE`.
  - "My number is 408-555-0134" → PII anonymized in the output.
  If a check fails, adjust topic definitions/examples, create a new version, re-test
  (counts as a retry).
- Outputs: guardrail ID and version → SSM.

### Phase 3 — CDK foundation and data (target done by 8:30 PM)

**P3.1 CDK app skeleton.**
- Steps: in `infra/`: `app.py`, `cdk.json`, `careline_infra/` package with one module
  per stack, a `Tags` aspect applying the 3 tags to everything, and a `config.py` that
  reads values from CDK context and SSM (`ssm.StringParameter.value_for_string_parameter`).
  Stacks must synthesize even if teammate-owned SSM params don't exist yet (use context
  defaults). Add `infra/tests/test_synth.py` with assertions per stack (fine-grained
  `aws_cdk.assertions.Template` checks: table count, TTL, GSIs, tags).
- Verify: `cdk synth` succeeds; `pytest infra/tests` green.

**P3.2 CareLineData.**
- Steps: four DynamoDB tables exactly as in the plan's "Data model":
  - `careline-residents` PK `resident_id`; GSI `by-zone` (`zone_id`, `risk_tier` Number).
  - `careline-calls` PK `outage_id`, SK `resident_attempt` (`<resident_id>#<n>`); TTL
    attribute `expires_at`; GSI `by-contact` (`contact_id`) for Connect callbacks.
  - `careline-tasks` PK `task_id`; GSI `by-status` (`status`, `priority` Number).
  - `careline-audit` PK `outage_id`, SK `ts_event` (`<iso-ts>#<uuid>`).
  All on-demand, encryption AWS-owned, removal policy DESTROY, PITR off.
  S3 bucket `careline-kb-<account>` (block public access, SSL only, DESTROY with
  auto-delete objects). Deploy.
- Verify: `describe-table` ACTIVE ×4; TTL enabled on calls; put + get + delete one
  test item per table (prefix `verify-`); bucket exists with public access blocked.
- Outputs: table names → `/careline/tables/*`; bucket name.

**P3.3 Seed loader (optional, coordinate with the data teammate).**
- Steps: if `scripts/seed.py` doesn't exist, write it: 40 synthetic residents in 4
  zones (10 tier 1, 15 tier 2, 15 tier 3; 20 en, 12 es, 8 hi), all phone numbers fake
  (`+1555010xxxx`) except numbers listed in `/careline/config/dialer-allow-list`, plus 5
  resource sites written to `kb/sites.md`. Idempotent (upsert). Mark every record
  `synthetic=true`. Do not run it against live tables if the data teammate has already
  seeded (check item count first).
- Verify: `scan --select COUNT` on residents = 40 after a run.

### Phase 4 — Core orchestration (target done by 10:30 PM)

**P4.1 Lambda packaging and functions.**
- Steps:
  1. `scripts/build_lambdas.sh`: for each folder in `lambdas/`, copy the source to
     `build/<name>/` and install its `requirements.txt` with
     `pip install --platform manylinux2014_aarch64 --implementation cp --python-version 3.12 --only-binary=:all: --target build/<name>/`.
     CDK uses `lambda.Code.from_asset("build/<name>")`. No Docker.
  2. Stubs (section 6.3) for any `lambdas/<name>/handler.py` that doesn't exist.
  3. In `CareLineCore`: functions from section 3.1, Python 3.12, arm64, 512 MB,
     timeout 30s (copilot 90s, lex-hook 10s), X-Ray active, Powertools layer (resolve
     the current public layer ARN for python3.12 arm64 via the docs MCP), log retention
     7 days, env vars: table names, bus name, `POWERTOOLS_SERVICE_NAME`, and
     `SSM_PREFIX=/careline`.
  4. One role per function, least privilege:
     - dialer: `connect:StartOutboundVoiceContact` on the instance; `dynamodb:PutItem/UpdateItem`
       on calls; `ssm:GetParameter*` on `/careline/*`.
     - lex-hook: `bedrock:InvokeModel*` on the extraction + fallback model/profile ARNs
       only; `bedrock:ApplyGuardrail` on the guardrail; `bedrock:RetrieveAndGenerate` and
       `bedrock:Retrieve` on the KB; calls table write; `states:SendTaskSuccess/Failure`;
       `events:PutEvents` on the bus.
     - call-status (invoked by the contact flow at disconnect/no-input): calls table
       update; `states:SendTaskSuccess/Failure`.
     - triage-step: residents read; calls, tasks, audit write; `events:PutEvents`.
     - outage-ended: `states:ListExecutions/StopExecution` on resident-check; calls read.
     - copilot: read-only DynamoDB (`GetItem/Query/Scan`) on all four tables;
       `bedrock:InvokeModel*` on the copilot + fallback profiles; ApplyGuardrail.
     - api: read on all tables; write on tasks and audit; `events:PutEvents`;
       `lambda:InvokeFunction` on copilot.
  5. Resource policies: `connect.amazonaws.com` may invoke lex-hook and call-status
     (source ARN = instance ARN); `lexv2.amazonaws.com` may invoke lex-hook.
- Verify: `cdk deploy CareLineCore`; each function `invoke` with a `{"healthcheck":true}`
  payload returns 200 and a JSON body; IAM Access Analyzer `validate-policy` on each
  inline policy shows no errors; `cdk synth` contains no `*` resource on Bedrock,
  DynamoDB or Connect actions.

**P4.2 Event bus.**
- Steps: custom bus `careline-events`; archive with 1-day retention (useful for replays
  during the demo); rules:
  - `source=careline.api, detail-type=OutageStarted` → state machine `careline-call-wave`.
  - `detail-type=OutageEnded` → `careline-outage-ended`.
  - `detail-type=CheckinCompleted` → CloudWatch log group `/careline/events` (audit trail
    for the video).
- Verify: `put-events` a test `CheckinCompleted` and see it in `/careline/events` within
  1 minute.

**P4.3 State machine `careline-resident-check` (Standard).**
- Steps: define in CDK (ASL via constructs). Input:
  `{outage_id, resident_id, attempt, phone_e164, language, risk_tier,
  timing: {call_timeout_seconds, retry_wait_seconds}, dry_run_outcome?}`.
  `timing` is computed once by whoever starts the wave (the API's `POST /outages`, from
  `/careline/config/time-scale`: retry = 600 / scale, timeout = 180 live or 20 in dry run)
  and copied into every execution input. Step Functions has no division intrinsic, and
  after a timeout the dialer's output is lost, so timing must travel in the input.
  Every Task state uses `ResultPath` (`$.call`, `$.triage`, `$.error`) so the original
  input survives each step.
  States:
  1. `PlaceCall`: Lambda dialer with `.waitForTaskToken`; `TimeoutSecondsPath
     $.timing.call_timeout_seconds`; catch `States.Timeout` (ResultPath `$.error`) →
     `NoAnswer`.
  2. `NoAnswer`: Choice on `$.attempt` < 2 → `WaitRetry` (Wait, `SecondsPath
     $.timing.retry_wait_seconds`) → `IncrementAttempt` (Pass,
     `States.MathAdd($.attempt, 1)`) → `PlaceCall`; else → `WelfareCheck` (Lambda
     triage-step with `mode=welfare_check`) → Succeed.
  3. `Triage`: Lambda triage-step → `$.triage = {triage, rule_id, next_wait_seconds|null}`.
  4. Choice on `$.triage.triage`: URGENT / HUMAN_REVIEW → Succeed (tasks already
     created); NEEDS_HELP / SAFE → `WaitRecheck` (`SecondsPath
     $.triage.next_wait_seconds`) → `ResetAttempt` (Pass, attempt = 0) → `PlaceCall`.
  5. Retries on Lambda service errors (2 attempts, backoff 2). Logging level ALL to
     `/careline/sfn`, X-Ray on.
- Verify (dry run, the feedback loop for this phase): with `dry_run_outcome` values
  `safe`, `urgent_battery`, `no_answer`, start 3 executions against a `verify-` outage ID
  and `time-scale=60`:
  - `safe` reaches `WaitRecheck`; stop it after it enters the wait.
  - `urgent_battery` ends Succeeded with a task in `careline-tasks` and an audit row.
  - `no_answer` loops twice and ends with a WELFARE_CHECK task.
  Use `get-execution-history` to assert the state path. Clean up `verify-` items after.

**P4.4 State machine `careline-call-wave`.**
- Steps: input `{outage_id, zone_id, timing, dry_run?}`. Query `careline-residents` GSI
  `by-zone` (direct `aws-sdk:dynamodb:query` integration, ascending `risk_tier`; unwrap
  the typed attribute values in an ItemSelector) → Map (MaxConcurrency 3) →
  fire-and-forget `StartExecution` of resident-check, passing `timing` and `dry_run`, with
  execution name `<outage_id>-<resident_id>` so a re-run of the same outage cannot
  double-call anyone. Because names are unique for 90 days, every verification run must
  use a fresh outage ID (`verify-<yyyymmddhhmmss>`).
- Verify: with seeded data and `dry_run=true`, an OutageStarted event for zone 1 starts
  exactly N resident-check executions (N = residents in zone 1), in tier order.

**P4.5 Outage ended.**
- Verify: after P4.4's run, an OutageEnded event stops every RUNNING resident-check
  execution for that outage within 1 minute.

### Phase 5 — API (target done by 11:15 PM)

**P5.1 CareLineApi.**
- Steps: REST API `careline-api` with a single Lambda proxy integration
  (`careline-api`, FastAPI + Mangum; stub if the teammate hasn't written it). Usage plan
  + API key `careline-dashboard` (store the key value in Secrets Manager
  `careline/api/key`), stage `prod`, throttling 20 rps / burst 40, access logs to
  `/careline/api`. CORS: the CloudFront URL from P7.1 and `http://localhost:5173`.
- Verify: `GET /health` with key → 200; without key → 403. `POST /outages` (stub) with
  a `verify-` zone puts an OutageStarted event (seen in `/careline/events` or the
  archive).
- Outputs: `/careline/api/url`, `/careline/api/key-id`.

### Phase 6 — Knowledge Base (target done by midnight)

**P6.1 Vector store and KB.**
- Steps: PRECHECK whether CloudFormation supports `AWS::S3Vectors::*` and a
  `AWS::Bedrock::KnowledgeBase` with an S3 Vectors storage configuration (docs MCP). If
  yes, add to `CareLineData`/`CareLineCore`; if not, create by API and record IDs.
  - Vector bucket `careline-vectors-<account>`, index `careline-sites`, dimension 1024,
    distance cosine.
  - KB `careline-kb` with Titan Text Embeddings V2, service role scoped to the KB bucket
    `kb/` prefix and the vector index.
  - Data source on `s3://careline-kb-<account>/kb/`, fixed-size chunking 300 tokens.
- Verify: KB status ACTIVE.

**P6.2 Content and ingestion.**
- Steps: upload `kb/sites.md` (from the seed script or the data teammate) and, if
  present, `kb/outage-faq.md`. If neither exists yet, generate `kb/sites.md` with the 5
  synthetic sites from the plan, clearly labeled synthetic. Start an ingestion job and
  poll until COMPLETE.
- Verify: `retrieve-and-generate` with the guardrail attached:
  - "Where can I charge my oxygen machine?" → answer cites a site from `sites.md`.
  - "Should I increase my oxygen flow?" → guardrail intervenes.
- Outputs: KB ID, data source ID → SSM.
- Fallback: if S3 Vectors or the KB is blocked, set `/careline/bedrock/kb-id` =
  `prompt-stuffed` and record that the lex-hook should put `kb/sites.md` in the prompt
  with the guardrail's grounding check. Notify the voice teammate.

### Phase 7 — Web hosting and observability (target done by 1:00 AM)

**P7.1 CareLineWeb.**
- Steps: private S3 bucket + CloudFront distribution (Origin Access Control, HTTPS
  only, default root `index.html`, SPA fallback 403/404 → `/index.html`). Deploy
  `web/dist` if it exists, else a placeholder `index.html` that says "CareLine dashboard
  deploying". Add `scripts/deploy_web.sh` (build the web app, sync to the bucket,
  invalidate `/*`) for the frontend teammate.
- Verify: `curl -I https://<cloudfront-domain>/` → 200; bucket not publicly readable.
- Outputs: `/careline/web/url`; update API CORS (P5.1) with this domain and redeploy.

**P7.2 CareLineObservability.**
- Steps: CloudWatch dashboard `CareLine` with widgets: calls placed (custom metric
  `CallsPlaced` emitted by dialer, namespace `CareLine`), resident-check executions
  started/succeeded/failed, Lambda errors and duration for all functions, Bedrock
  invocations and latency by model ID (`AWS/Bedrock`), guardrail interventions, API 4xx/5xx.
  Alarms (to an SNS topic emailed to `alertEmail`): any Lambda error rate > 5% over 5 min;
  resident-check failures ≥ 1; API 5xx ≥ 5 in 5 min.
- Verify: dashboard exists; after a dry-run wave, the executions and Bedrock widgets
  show non-zero data (check with `get-metric-data`).

### Phase 8 — End-to-end rehearsal and handoff (target done by 2:00 AM)

**P8.1 End-to-end dry run.**
- Steps: `TIME_SCALE=60`, seeded data, `dry_run=true`: POST `/outages` for zone 2 via the
  API → wave → resident checks with mixed outcomes → tasks and audit rows → OutageEnded.
  Then invoke the copilot function (stub or real) for zone 2 and confirm a Bedrock
  invocation appears in `/careline/bedrock`.
- Verify: counts by triage in `careline-tasks` match the dry-run outcomes; zero failed
  executions; dashboard populated. Record the numbers in STATE.md.

**P8.2 Live call smoke test (WAITING allowed).**
- Depends: phone number claimed (P1.2) or web calling ready; flow ID and bot alias in SSM;
  at least one allow-listed number.
- Steps: one resident-check with `dry_run` off to an allow-listed teammate number.
- Verify: call connects, a Calls row with `status=ANSWERED` and extracted JSON appears,
  the execution reaches Triage. If waiting on the teammate, mark WAITING and re-check
  each loop.

**P8.3 Handoff.**
- Steps: write `docs/infra/HANDOFF.md`: what is deployed; how each teammate deploys their
  code (`scripts/build_lambdas.sh && cd infra && cdk deploy CareLineCore --hotswap`);
  how to switch `TIME_SCALE` and `dialer-allow-list` (SSM, no redeploy); how to read
  logs; Connect admin login (secret name only); web deploy script; known blockers.
  Generate `.env.local` (gitignored) from SSM for teammates. Write `scripts/teardown.sh`
  (destroy stacks, release number, delete Connect instance, delete KB) **but do not run
  it** — it is gate G1.
- Verify: `python scripts/verify_infra.py` all green (except WAITING items, listed).

**P8.4 Freeze (from 6:00 AM PT).**
- From 6:00 AM PT Saturday, make no infrastructure changes except fixes for something
  broken that blocks recording. Record any such change in STATE.md.

---

## 6. Reference

### 6.1 `scripts/verify_infra.py` (the regression loop)

- Read-only. Uses boto3 and SSM `/careline/*` to find resources.
- One function per check, grouped by phase: `check_p1_connect_instance_active()`, …
- Each check returns `{id, phase, status: pass|fail|waiting|skipped, evidence, hint}`.
- Prints a table and writes `docs/infra/verify-report.json`; exit code 1 if any check
  for a phase marked DONE in STATE.md fails.
- Run after every phase and at FINISH. A failing check reopens its task.

### 6.2 Packaging without Docker

Use `scripts/build_lambdas.sh` (P4.1). Every Lambda folder may have its own
`requirements.txt`. Shared code goes in `lambdas/common/` and is copied into each build
folder. Keep FastAPI, Mangum and Pydantic in the api function only, and Pydantic in
lex-hook and copilot.

### 6.3 Stubs (only when `lambdas/<name>/handler.py` is missing)

Every stub: logs the event with Powertools, returns `{"statusCode":200,"body":"stub"}`
for `{"healthcheck":true}`, and has a header comment
`# STUB generated by infra runbook — replace with real implementation`.
Behavior needed for dry runs:

| Function | Stub behavior |
| --- | --- |
| dialer | If `dry_run_outcome` is present (or `/careline/config/dry-run` = true): don't call Connect. For `no_answer`, do nothing (let the timeout fire). Otherwise write a Calls row and call `SendTaskSuccess` with a canned extraction for the outcome |
| triage-step | If `lambdas/triage/rules.py` exists, import and use it. Else: `urgent_battery` → URGENT/R2, `safe` → SAFE/R7, welfare mode → WELFARE_CHECK task. Write tasks and an audit row. `next_wait_seconds = 14400 / time_scale` for SAFE |
| outage-ended | Real implementation (infra-owned): stop running executions for the outage |
| call-status | Real implementation (infra-owned): on disconnect/no-input from the flow, look up the task token by `contact_id` and send success with `status` |
| lex-hook, copilot, api | Health check + echo; api also serves `GET /health` and `POST /outages`, which reads `/careline/config/time-scale`, computes `timing`, and puts OutageStarted with it |

### 6.4 `.env.local`

Generated from SSM, gitignored, one `KEY=value` per line matching `.env.example`. Never
include secret values; reference secret names.

---

## 7. Human gates

When you hit a gate: write it in STATE.md ("Gates" table: ID, what you need, why, what
you'll do meanwhile), send the human **one** concise message, and continue with
independent tasks. Re-check the gate each loop.

| Gate | Trigger | What to ask |
| --- | --- | --- |
| G1 | Any delete, release or teardown; a failed stack needing deletion | "May I delete <resource>? Reason: <one line>." |
| G2 | Phone number claim failed | "Number claim failed with <error>. Please open an AWS Support case or ask organizers. I've set web-calling fallback and continued." |
| G3 | Missing human-only input: alert email, allow-listed phone numbers, passwords for login | Ask for exactly the value needed and where it will be stored |
| G4 | An SCP or permission blocks a required service | "<service> is blocked by the event account (<error>). Please ask organizers. Fallback in use: <fallback or none>." |
| G5 | Spend estimate > $20, or Budget alert | "Spend is at <amount>. Continue?" |

---

## 8. Definition of done

- Every task DONE, or WAITING/BLOCKED with a documented fallback in use.
- `scripts/verify_infra.py` green for all DONE tasks.
- `docs/infra-outputs.md`, SSM `/careline/*`, `docs/infra/HANDOFF.md` and `.env.local`
  complete and consistent.
- An end-to-end dry run (P8.1) recorded in STATE.md with counts.
- No secrets in git (`git grep -nE "(AKIA|aws_secret|password)"` returns nothing).
- Final report in STATE.md: what's live, what's stubbed, what's waiting on whom, and
  the teardown steps.
