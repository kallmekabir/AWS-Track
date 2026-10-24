# Backend Core — Design

## 1. Overview

Two CDK stacks in us-east-1:

- **CareLineData** — the four DynamoDB tables and their GSIs. No compute. All tables
  on-demand, `RemovalPolicy.DESTROY`.
- **CareLineCore** — the Lambdas, both Step Functions state machines, the EventBridge
  rules, and one least-privilege IAM role per Lambda. Imports table ARNs/names from
  `CareLineData`.

Connect, the contact flow and the Lex bot are console-built; CDK only consumes their IDs
from context/env. Nothing in this spec deploys Connect or Lex resources.

```
EventBridge (careline.outage.started)
    -> CallWave SM
         -> query Residents-by-zone (tier order)
         -> Map(MaxConcurrency=3)
              -> ResidentCheck SM (one per resident)
                   -> dialer (waitForTaskToken, 180s)   --Connect--> call
                   <-- lex_hook SendTaskSuccess (answered) | timeout (NO_ANSWER)
                   -> triage_step (rules -> tasks -> audit)
                   -> Choice: urgent | human | needs/safe->recheck wait | retry | welfare
EventBridge (careline.outage.ended) -> outage_ended Lambda -> StopExecution on open ResidentChecks
EventBridge (careline.checkin.completed) -> (bus event for dashboard/eval)
```

## 2. CDK stacks

### 2.1 CareLineData (`infra/stacks/data_stack.py`)

Common table props: `billing_mode=PAY_PER_REQUEST`, `removal_policy=DESTROY`.

| Table | PK | SK | TTL | GSI |
| --- | --- | --- | --- | --- |
| `Residents` | `resident_id` (S) | — | — | `gsi_zone`: PK `zone_id` (S), SK `risk_tier` (N) |
| `Calls` | `outage_id` (S) | `resident_id#attempt` (S) | `expires_at` | — |
| `Tasks` | `task_id` (S) | — | — | `gsi_status`: PK `status` (S), SK `priority` (N) |
| `Audit` | `outage_id` (S) | `ts#event_id` (S) | — | — |

GSI projections: `gsi_zone` projects the attributes CallWave needs
(`resident_id`, `phone_e164`, `language`, `first_name`, `risk_tier`, `device_type`) via
`INCLUDE`; `gsi_status` uses `ALL`.

Stack exports (Cfn outputs + instance attributes): the four `ITable` objects, consumed by
`CareLineCore` by passing the construct references into its constructor (same app, so no
cross-stack string lookups needed beyond CDK's automatic export/import).

### 2.2 CareLineCore (`infra/stacks/core_stack.py`)

Constructor takes the four tables from `CareLineData`. Context inputs (via
`app.node.try_get_context` with env-var fallback), validated at synth; missing required
values raise `ValueError`:

| Context / env | Used by |
| --- | --- |
| `CONNECT_INSTANCE_ID`, `CONNECT_FLOW_ID`, `CONNECT_SOURCE_NUMBER` | dialer |
| `BEDROCK_EXTRACT_MODEL_ID` | lex_hook |
| `BEDROCK_KB_ID`, `BEDROCK_GUARDRAIL_ID` | (passed through; used by voice-agent spec) |
| `TIME_SCALE` (default `1`) | ResidentCheck waits |
| `DIALER_ALLOW_LIST` | dialer |

All Lambdas: Python 3.12, architecture arm64, bundled with AWS Lambda Powertools layer or
in the deployment package; `POWERTOOLS_SERVICE_NAME=careline`, `LOG_LEVEL=INFO`,
tracing active.

## 3. Lambdas

Each lives under `lambdas/<name>/handler.py`; logic in importable modules so the eval and
unit tests import directly (per `structure.md`). Handlers stay thin.

### 3.1 dialer (`lambdas/dialer/`)

- `handler.py` — Step Functions task target; input `{resident_id, outage_id, attempt,
  task_token}`.
- `allowlist.py` — `is_allowed(phone_e164, allow_list)`; pure, unit-tested.
- Reads resident from `Residents`, checks `DIALER_ALLOW_LIST`. If not allowed → writes
  `Calls` item `status=SKIPPED_NOT_ALLOWLISTED`, returns without calling Connect. If
  allowed → `connect.start_outbound_voice_contact(...)` with the five attributes, writes
  `Calls` item `status=QUEUED`, `contact_id`, `task_token`, `expires_at`.
- Env: `TABLE_RESIDENTS`, `TABLE_CALLS`, `CONNECT_INSTANCE_ID`, `CONNECT_FLOW_ID`,
  `CONNECT_SOURCE_NUMBER`, `DIALER_ALLOW_LIST`.
- IAM: `connect:StartOutboundVoiceContact` (resource = the instance ARN);
  `dynamodb:GetItem` on `Residents`; `dynamodb:PutItem/UpdateItem` on `Calls`.

### 3.2 lex_hook (`lambdas/lex_hook/`)

- `handler.py` — Lex V2 code-hook event in/out.
- `redact.py` — regex PII redaction (phone, address, name tokens). Pure, unit-tested.
- `extract.py` — builds the Converse request, calls Bedrock, parses + validates with the
  Pydantic model from `models.py`; on validation failure coerces fields to
  `unsure`/`null`. Pure except the one boto3 Bedrock call (injected client for tests).
- `models.py` — Pydantic v2 `CheckInExtraction` mirroring `schemas/checkin.json`.
- `complete.py` — on all-slots-filled: write `Calls`, `SendTaskSuccess`, `PutEvents`.
- Route logic: distress ≠ none → `route=EMERGENCY`, close intent.
- Env: `BEDROCK_EXTRACT_MODEL_ID`, `TABLE_CALLS`, `EVENT_BUS_NAME`, `AWS_REGION`.
- IAM: `bedrock:InvokeModel` on the extract model ARN; `states:SendTaskSuccess`;
  `events:PutEvents` on the bus; `dynamodb:UpdateItem` on `Calls`.

### 3.3 triage_step (`lambdas/triage/`)

- `rules.py` — **pure**, no AWS. `decide(extracted: dict, resident: dict,
  emergency_intent: bool) -> tuple[str, str]` returning `(triage, rule_id)`.
- `handler.py` — Step Functions task target; loads resident + call result, calls
  `rules.decide`, persists `triage`/`rule_id` to `Calls`, creates `Tasks`, writes `Audit`
  with `inputs_hash = sha256(canonical_json(rule_inputs))`.
- `tasks.py` — maps a `(triage, rule_id, needs)` to the `Tasks` to create
  (OPERATOR_ALERT, WELFARE_CHECK, TRANSPORT, MEDICINE, FOOD, CHARGING/INFO). Pure.
- Env: `TABLE_RESIDENTS`, `TABLE_CALLS`, `TABLE_TASKS`, `TABLE_AUDIT`.
- IAM: read `Residents`/`Calls`; write `Calls`, `Tasks`, `Audit`.

### 3.4 outage_ended (`lambdas/orchestration/outage_ended.py`)

- Triggered by `careline.outage.ended`. Lists running `ResidentCheck` executions tagged /
  named with the `outage_id` prefix and calls `states:StopExecution` on each.
- Env: `RESIDENT_CHECK_SM_ARN`.
- IAM: `states:ListExecutions`, `states:StopExecution` on the ResidentCheck SM ARN.

### 3.5 callwave_query (`lambdas/orchestration/callwave_query.py`)

- Helper invoked at the head of CallWave: queries `Residents.gsi_zone` for the zone,
  `ScanIndexForward=True` on `risk_tier`, returns the ordered resident list for the Map.
- IAM: `dynamodb:Query` on `Residents`/`gsi_zone`.

## 4. Step Functions (ASL outline)

Durations are authored as `"{} / TIME_SCALE"` computed at build time is not possible, so
waits use `SecondsPath` pointing at values the preceding Lambda computed by dividing by
`TIME_SCALE`. Each Lambda that precedes a Wait returns the already-scaled seconds.

### 4.1 ResidentCheck (Standard)

```
PlaceCall (Task: dialer, .waitForTaskToken)
  TimeoutSeconds: 180            # no token in 180s => NO_ANSWER
  Catch States.Timeout -> MarkNoAnswer
  Next: Triage
MarkNoAnswer (Pass: status=NO_ANSWER) -> CheckAttempts
CheckAttempts (Choice):
  attempt < 2  -> ComputeRetryWait
  otherwise    -> CreateWelfareTask
ComputeRetryWait (Task: compute_wait, mode=retry) -> WaitRetry
WaitRetry (Wait: SecondsPath=$.wait_seconds) -> BumpAttempt -> PlaceCall
CreateWelfareTask (Task: triage_step, mode=welfare) -> Done
Triage (Task: triage_step, mode=decide) -> RouteTriage
RouteTriage (Choice):
  triage == URGENT        -> Done           # operator alert already created
  triage == HUMAN_REVIEW  -> Done           # review task already created
  triage in [NEEDS_HELP, SAFE] -> ComputeRecheckWait
ComputeRecheckWait (Task: compute_wait, mode=recheck) -> WaitRecheck
WaitRecheck (Wait: SecondsPath=$.wait_seconds) -> BumpAttempt2 -> PlaceCall
Done (Succeed)
```

`compute_wait` (small Lambda or a branch inside `triage_step`) computes:
- retry: `600 / TIME_SCALE` seconds.
- recheck: `max(battery_hours/2 * 3600, 1800) / TIME_SCALE`; if `device_has_power == no`
  then `4*3600 / TIME_SCALE`.

### 4.2 CallWave (Standard)

```
QueryZone (Task: callwave_query) -> FanOut
FanOut (Map, MaxConcurrency: 3, ItemsPath=$.residents):
  Iterator: StartResidentCheck (Task: states:StartExecution.sync for ResidentCheck SM,
            Name = "<outage_id>-<resident_id>")  # name prefix lets outage_ended find them
-> Done (Succeed)
```

## 5. EventBridge

Default bus (or a named `careline` bus; design uses the default for simplicity).

| Rule | Pattern (`source`, `detail-type`) | Target |
| --- | --- | --- |
| `OutageStartedRule` | `careline`, `careline.outage.started` | `CallWave` SM (StartExecution) |
| `OutageEndedRule` | `careline`, `careline.outage.ended` | `outage_ended` Lambda |
| `CheckinCompletedRule` | `careline`, `careline.checkin.completed` | (logging/archive; consumed by dashboard & eval specs) |

The EventBridge→StepFunctions target needs an IAM role with `states:StartExecution` on
the CallWave SM; EventBridge→Lambda uses a resource-based permission.

## 6. IAM (least privilege, one role per Lambda)

| Lambda | Allowed actions (resources) |
| --- | --- |
| dialer | `connect:StartOutboundVoiceContact` (instance); `dynamodb:GetItem` (Residents); `dynamodb:PutItem,UpdateItem` (Calls) |
| lex_hook | `bedrock:InvokeModel` (extract model); `states:SendTaskSuccess` (*); `events:PutEvents` (bus); `dynamodb:UpdateItem` (Calls) |
| triage_step | `dynamodb:GetItem` (Residents, Calls); `dynamodb:PutItem,UpdateItem` (Calls, Tasks, Audit) |
| callwave_query | `dynamodb:Query` (Residents + gsi_zone) |
| outage_ended | `states:ListExecutions,StopExecution` (ResidentCheck SM) |

No role carries `*` on actions. CDK grants are created with `table.grant_*` and explicit
`PolicyStatement`s scoped to ARNs. No static credentials anywhere; Lambdas use their
execution role.

## 7. Environment variables (per Lambda)

| Var | dialer | lex_hook | triage_step | outage_ended |
| --- | :-: | :-: | :-: | :-: |
| `AWS_REGION` | ✓ | ✓ | ✓ | ✓ |
| `TABLE_RESIDENTS` | ✓ |  | ✓ |  |
| `TABLE_CALLS` | ✓ | ✓ | ✓ |  |
| `TABLE_TASKS` |  |  | ✓ |  |
| `TABLE_AUDIT` |  |  | ✓ |  |
| `CONNECT_INSTANCE_ID` | ✓ |  |  |  |
| `CONNECT_FLOW_ID` | ✓ |  |  |  |
| `CONNECT_SOURCE_NUMBER` | ✓ |  |  |  |
| `DIALER_ALLOW_LIST` | ✓ |  |  |  |
| `BEDROCK_EXTRACT_MODEL_ID` |  | ✓ |  |  |
| `EVENT_BUS_NAME` |  | ✓ |  |  |
| `TIME_SCALE` |  |  | ✓ |  |
| `RESIDENT_CHECK_SM_ARN` |  |  |  | ✓ |
| `POWERTOOLS_SERVICE_NAME`, `LOG_LEVEL` | ✓ | ✓ | ✓ | ✓ |

## 8. Pydantic model

`CheckInExtraction` (Pydantic v2) mirrors `schemas/checkin.json` exactly: `is_safe`,
`device_has_power` and `distress_signals`/`needs` as `Literal` enums; `battery_hours`
`float | None` with `ge=0`; `confidence` `float` in `[0,1]`. A `from_model_output`
classmethod parses model JSON and, on any `ValidationError`, downgrades the offending
field(s) to `unsure`/`null` and records which were downgraded (so the rules can treat
them as uncertain → R4).

## 9. Privacy & audit specifics

- `redact.py` runs before extraction and before anything is persisted.
- `Calls.transcript_redacted` holds only the redacted text; no diagnosis/medication text.
- `Audit` stores `rule_id`, `inputs_hash` (SHA-256 of canonical rule inputs), `before`,
  `after`, `reason`, `actor`, `action` — never raw content.
- `Calls.expires_at` TTL = now + 86400 s on every write.

## 10. Testing approach

- `rules.py`, `allowlist.py`, `redact.py`, `tasks.py`, `models.py`: pure pytest, no AWS.
- dialer / lex_hook / triage_step handlers: pytest + moto for DynamoDB; boto3 Connect,
  Step Functions and Bedrock clients stubbed/injected (botocore Stubber or a fake client).
- CDK: `cdk synth` + an `assertions.Template` test asserting table count/keys/TTL, GSIs,
  Map `MaxConcurrency=3`, the 180 s timeout, and that no IAM policy contains `"*"` actions.
