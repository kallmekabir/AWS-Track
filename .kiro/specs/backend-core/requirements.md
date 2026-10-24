# Backend Core — Requirements

Scope: the serverless backend for CareLine (no frontend). Covers CDK stacks
`CareLineData` and `CareLineCore` in us-east-1, the four DynamoDB tables, the triage
rules, the `dialer`, `lex_hook`, `triage_step` and `outage_ended` Lambdas, the
`ResidentCheck` and `CallWave` Step Functions state machines, the EventBridge wiring and
`scripts/seed.py`.

The Amazon Connect instance, contact flow and Lex bot are built in the console and are
out of scope here; their IDs are read from env vars / CDK context (see `.env.example`).

## Steering rules that constrain every requirement

- Bedrock extracts fields only; it never assigns triage. Triage is decided by the
  deterministic rules R0–R7 in `lambdas/triage/rules.py`.
- Anything unclear or low-confidence goes to a human (R4), never to SAFE.
- Every decision writes an `Audit` record with a `rule_id`; overrides require a reason.
- No diagnoses, medication names or raw transcripts are stored; redacted transcripts
  expire after 24 h (`Calls.expires_at` TTL).
- All resident data is synthetic; the dialer only calls numbers on `DIALER_ALLOW_LIST`.
- Least-privilege IAM role per Lambda; no credentials in code; region us-east-1 only.

---

## Requirement 1 — Infrastructure as code (CDK)

**User story:** As an operator-team engineer, I want the backend defined as CDK stacks
so I can deploy and tear down the whole system reproducibly in us-east-1.

Acceptance criteria:
1. THE SYSTEM SHALL define a Python AWS CDK app under `infra/` with exactly two stacks,
   `CareLineData` and `CareLineCore`, both pinned to region `us-east-1`.
2. WHERE a resource holds demo-only state, THE SYSTEM SHALL set `RemovalPolicy.DESTROY`
   so `cdk destroy --all` removes it.
3. THE SYSTEM SHALL read the Connect instance ID, contact-flow ID, source number,
   Bedrock model IDs, `TIME_SCALE` and `DIALER_ALLOW_LIST` from env vars or CDK context,
   never hard-coded.
4. IF a required context value (e.g. `CONNECT_INSTANCE_ID`) is missing at synth time,
   THEN THE SYSTEM SHALL fail synth with a clear message naming the missing value.
5. THE SYSTEM SHALL grant each Lambda its own least-privilege IAM role and SHALL NOT
   attach any wildcard admin policy.

## Requirement 2 — DynamoDB data model

**User story:** As the backend, I want four on-demand tables so resident, call, task and
audit state is stored with automatic transcript expiry.

Acceptance criteria:
1. THE SYSTEM SHALL create four DynamoDB tables with on-demand (PAY_PER_REQUEST) billing
   and `RemovalPolicy.DESTROY`: `Residents`, `Calls`, `Tasks`, `Audit`.
2. THE SYSTEM SHALL key `Residents` on `resident_id` (PK) and SHALL provide a GSI
   partitioned on `zone_id` with sort key `risk_tier` for risk-ordered zone queries.
3. THE SYSTEM SHALL key `Calls` on `outage_id` (PK) and `resident_id#attempt` (SK), and
   SHALL enable TTL on the `expires_at` attribute.
4. WHEN a `Calls` item is written, THE SYSTEM SHALL set `expires_at` to now + 24 h.
5. THE SYSTEM SHALL key `Tasks` on `task_id` (PK) and SHALL provide a GSI partitioned on
   `status` with sort key `priority` for the operator queue.
6. THE SYSTEM SHALL key `Audit` on `outage_id` (PK) and `ts#event_id` (SK).
7. THE SYSTEM SHALL NOT store diagnoses, medication names or raw unredacted transcripts
   in any table; only redacted transcript text and decision codes are allowed.

## Requirement 3 — Triage rules R0–R7 (pure Python)

**User story:** As a reviewer, I want triage decided by deterministic, fully tested rules
so the model never marks an at-risk resident safe.

Acceptance criteria:
1. THE SYSTEM SHALL implement `lambdas/triage/rules.py` as pure Python with no AWS calls
   and no I/O, exposing a function returning a `(triage, rule_id)` pair.
2. THE SYSTEM SHALL evaluate rules in order R0→R7 and return the first match.
3. WHEN an emergency intent is present OR `distress_signals` contains any value other
   than `none`, THE SYSTEM SHALL return `(URGENT, "R0")`.
4. WHEN `device_has_power = no` AND `risk_tier = 1`, THE SYSTEM SHALL return
   `(URGENT, "R1")`.
5. WHEN `device_has_power = on_battery` AND `battery_hours < 4`, OR `battery_hours` is
   unknown (null) at `risk_tier = 1`, THE SYSTEM SHALL return `(URGENT, "R2")`.
6. WHEN `is_safe = no`, THE SYSTEM SHALL return `(URGENT, "R3")`.
7. WHEN any key field is `unsure` OR `confidence < 0.7`, at `risk_tier` 1 or 2, THE
   SYSTEM SHALL return `(HUMAN_REVIEW, "R4")`.
8. WHEN `needs` includes medicine, transport or charging, THE SYSTEM SHALL return
   `(NEEDS_HELP, "R5")`.
9. WHEN `needs` includes food only, THE SYSTEM SHALL return `(NEEDS_HELP, "R6")`.
10. WHEN no earlier rule matches, THE SYSTEM SHALL return `(SAFE, "R7")`.
11. THE SYSTEM SHALL have unit tests covering every rule R0–R7 and the ordering
    (e.g. a distress signal outranks a low battery), running with no network access.

## Requirement 4 — Dialer Lambda

**User story:** As the orchestration workflow, I want a dialer that places outbound calls
only to allow-listed numbers and records the Step Functions task token.

Acceptance criteria:
1. WHEN invoked with `resident_id`, `outage_id`, `attempt` and a Step Functions task
   token, THE SYSTEM SHALL call Connect `StartOutboundVoiceContact` with attributes
   `resident_id`, `outage_id`, `attempt`, `lang` and `first_name`.
2. IF the resident's `phone_e164` is not in `DIALER_ALLOW_LIST`, THEN THE SYSTEM SHALL
   refuse to place the call, SHALL NOT call Connect, and SHALL record the attempt as
   skipped.
3. WHEN a call is placed, THE SYSTEM SHALL write a `Calls` item for
   `outage_id` / `resident_id#attempt` with `status=QUEUED`, the returned `contact_id`,
   the Step Functions `task_token` and `expires_at` = now + 24 h.
4. THE SYSTEM SHALL read Connect IDs and the source number only from env vars.
5. THE SYSTEM SHALL use a least-privilege role allowing only
   `connect:StartOutboundVoiceContact` and write access to the `Calls` table.

## Requirement 5 — Lex hook Lambda (Bedrock extraction)

**User story:** As the voice path, I want each turn redacted and extracted into validated
JSON so triage runs on clean, schema-valid fields and no PII is stored.

Acceptance criteria:
1. WHEN `lex_hook` receives a turn, THE SYSTEM SHALL redact phone numbers, street
   addresses and names from the transcript with regex before any model call or storage.
2. THE SYSTEM SHALL call Bedrock Converse with the model id from
   `BEDROCK_EXTRACT_MODEL_ID` at temperature 0 and SHALL request JSON matching
   `schemas/checkin.json`.
3. THE SYSTEM SHALL validate the model output with a Pydantic v2 model generated from
   `schemas/checkin.json`; IF a field fails validation, THEN THE SYSTEM SHALL set that
   field to `unsure` (or `null` for `battery_hours`) rather than trust the raw output.
4. WHEN extraction resolves a slot value, THE SYSTEM SHALL fill the matching Lex slot so
   the bot does not re-ask.
5. WHEN `distress_signals` contains any value other than `none`, THE SYSTEM SHALL set the
   session attribute `route=EMERGENCY` and close the intent immediately.
6. WHEN all slots are filled, THE SYSTEM SHALL write the extracted JSON and redacted
   transcript to the `Calls` item, call Step Functions `SendTaskSuccess` with the stored
   task token and the call result, and emit an EventBridge event
   `careline.checkin.completed`.
7. THE SYSTEM SHALL NOT store diagnoses or medication names and SHALL NOT log the raw
   unredacted transcript.
8. THE SYSTEM SHALL use a least-privilege role allowing `bedrock:InvokeModel` on the
   extract model, `states:SendTaskSuccess`, `events:PutEvents`, and read/write on `Calls`.

## Requirement 6 — Triage step Lambda

**User story:** As the workflow, I want a step that runs the rules, creates tasks and
writes an auditable decision for each call result.

Acceptance criteria:
1. WHEN invoked with a call result, THE SYSTEM SHALL call `rules.decide(...)` and persist
   the returned `triage` and `rule_id` onto the `Calls` item.
2. WHEN the triage implies work (per R0–R6 actions in the plan), THE SYSTEM SHALL create
   the matching `Tasks` item(s) with the correct `type` and `priority`.
3. WHEN a decision is made, THE SYSTEM SHALL write an `Audit` record containing `actor`,
   `action`, `resident_id`, the `rule_id` and a SHA-256 `inputs_hash` of the rule inputs.
4. THE SYSTEM SHALL NOT include raw transcript, diagnosis or medication text in the audit
   record; only codes and the hash.
5. THE SYSTEM SHALL return the triage decision to the state machine so the Choice state
   can route it.
6. THE SYSTEM SHALL use a least-privilege role allowing write on `Calls`, `Tasks` and
   `Audit` only.

## Requirement 7 — ResidentCheck state machine

**User story:** As the workflow, I want each resident handled durably with retries,
welfare-check escalation and battery-runway rechecks, time-compressed for demos.

Acceptance criteria:
1. THE SYSTEM SHALL place the call using the dialer with `.waitForTaskToken` and a
   180-second heartbeat/timeout; WHEN the token is not returned within 180 s, THE SYSTEM
   SHALL treat the attempt as `NO_ANSWER`.
2. WHEN an attempt is `NO_ANSWER` AND attempts < 2, THE SYSTEM SHALL wait 10 minutes
   (divided by `TIME_SCALE`) and retry.
3. WHEN two attempts have failed, THE SYSTEM SHALL create a `WELFARE_CHECK` task
   (priority by risk tier) and end the execution.
4. WHEN a call is answered, THE SYSTEM SHALL run `triage_step` and route on its result.
5. WHEN the resident is SAFE or NEEDS_HELP, THE SYSTEM SHALL schedule a recheck wait of
   half the battery runway with a 30-minute minimum, OR 4 hours if device power is off,
   each divided by `TIME_SCALE`, then place the next call.
6. THE SYSTEM SHALL divide every wait duration by the `TIME_SCALE` env var.

## Requirement 8 — CallWave state machine

**User story:** As the outage workflow, I want to fan out one ResidentCheck per resident
in a zone, highest risk first, without exceeding the Connect concurrency limit.

Acceptance criteria:
1. WHEN started with an `outage_id` and `zone_id`, THE SYSTEM SHALL query `Residents` by
   `zone_id` in ascending `risk_tier` order (tier 1 first) using the zone GSI.
2. THE SYSTEM SHALL run a Map state over the residents with `MaxConcurrency = 3`, starting
   one `ResidentCheck` execution per resident.

## Requirement 9 — EventBridge wiring

**User story:** As the operator, I want outage start/end events to drive the workflows so
calls begin on trigger and stop when power is restored.

Acceptance criteria:
1. WHEN a `careline.outage.started` event is published, THE SYSTEM SHALL start a
   `CallWave` execution for that `outage_id` / `zone_id`.
2. WHEN a `careline.outage.ended` event is published, THE SYSTEM SHALL invoke the
   `outage_ended` Lambda, which SHALL stop every open `ResidentCheck` execution for that
   `outage_id`.
3. THE SYSTEM SHALL route the `careline.checkin.completed` event emitted by `lex_hook` so
   it is available for downstream consumers (dashboard/eval), without starting new calls.

## Requirement 10 — Seed script

**User story:** As person D, I want a seed script that loads synthetic residents and
resource sites so the demo and eval have realistic data.

Acceptance criteria:
1. THE SYSTEM SHALL provide `scripts/seed.py` that writes 40 synthetic residents across
   4 zones: 10 at `risk_tier=1`, 15 at `risk_tier=2`, 15 at `risk_tier=3`.
2. THE SYSTEM SHALL assign languages 20 `en`, 12 `es`, 8 `hi`.
3. THE SYSTEM SHALL seed 5 resource sites (2 charging/cooling centers, 1 shelter,
   1 pharmacy with backup power, 1 food distribution point) with address and hours.
4. THE SYSTEM SHALL set `consent=true` on every resident and SHALL use phone numbers that
   are synthetic unless explicitly overridden by numbers on `DIALER_ALLOW_LIST`.
5. THE SYSTEM SHALL be idempotent: re-running overwrites the same resident/site IDs
   without creating duplicates.
