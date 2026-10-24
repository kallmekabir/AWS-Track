# Backend Core — Tasks

Each task is 15–45 minutes, lists the files it touches and how it is tested. Do them in
order; commit after each. Do not deploy — this spec ends at code + passing local tests.

Conventions: Python 3.12, boto3, AWS Lambda Powertools, Pydantic v2, pytest + moto.
Tests sit next to code as `test_*.py`.

---

## Phase A — Project scaffolding

### Task 1 — Python tooling and dependencies (15 min)
- Files: `requirements.txt`, `requirements-dev.txt`, `pyproject.toml` (or `setup.cfg` for
  pytest config), `infra/cdk.json`.
- Add runtime deps (boto3, aws-lambda-powertools, pydantic>=2) and dev deps (pytest,
  moto, aws-cdk-lib, constructs).
- Test: `pip install -r requirements-dev.txt` succeeds; `pytest --version` runs.

### Task 2 — CDK app entry and context validation (30 min)
- Files: `infra/app.py`, `infra/stacks/__init__.py`, `infra/config.py`.
- `config.py` reads context/env for all values in design §2.2 and raises `ValueError`
  naming any missing required value. `app.py` instantiates both stacks in us-east-1.
- Test: `infra/test_config.py` (pytest) — missing `CONNECT_INSTANCE_ID` raises with the
  name in the message; a full context builds a config object.

---

## Phase B — Data layer

### Task 3 — CareLineData stack (30 min)
- Files: `infra/stacks/data_stack.py`.
- Four tables per design §2.1, on-demand, `RemovalPolicy.DESTROY`, `Calls` TTL on
  `expires_at`, `gsi_zone` on Residents, `gsi_status` on Tasks.
- Test: `infra/test_data_stack.py` using `aws_cdk.assertions.Template` — asserts 4 tables,
  correct key schemas, TTL enabled on Calls, both GSIs present, billing PAY_PER_REQUEST.

---

## Phase C — Pure logic (no AWS)

### Task 4 — Pydantic CheckInExtraction model (30 min)
- Files: `lambdas/lex_hook/models.py`, `lambdas/lex_hook/test_models.py`.
- Mirror `schemas/checkin.json`; add `from_model_output` that downgrades invalid fields to
  `unsure`/`null` and reports downgraded field names.
- Test: valid JSON parses; out-of-range `confidence`, bad enum, and negative
  `battery_hours` each downgrade the right field; `battery_hours=null` is accepted.

### Task 5 — Triage rules R0–R7 (45 min)
- Files: `lambdas/triage/rules.py`, `lambdas/triage/test_rules.py`.
- Implement `decide(extracted, resident, emergency_intent) -> (triage, rule_id)`, first
  match wins, exactly R0–R7 from requirements §3 / the plan.
- Test: one case per rule plus ordering cases (distress + low battery → R0; unsure at
  tier 1 → R4 not SAFE; food-only → R6; nothing → R7). No network (verify no boto3 import
  in `rules.py`).

### Task 6 — Task mapping (20 min)
- Files: `lambdas/triage/tasks.py`, `lambdas/triage/test_tasks.py`.
- Map `(triage, rule_id, needs, risk_tier)` → list of Task dicts with `type`/`priority`.
- Test: R0→OPERATOR_ALERT; R1→alert+transport; R5 with medicine+transport→two tasks;
  welfare mode→WELFARE_CHECK priority by tier.

### Task 7 — Allow-list guard (15 min)
- Files: `lambdas/dialer/allowlist.py`, `lambdas/dialer/test_allowlist.py`.
- `is_allowed(phone_e164, allow_list_csv)`; normalizes whitespace; empty list → nothing
  allowed.
- Test: allowed number passes; non-listed fails; empty env fails closed.

### Task 8 — PII redaction (30 min)
- Files: `lambdas/lex_hook/redact.py`, `lambdas/lex_hook/test_redact.py`.
- Regex redaction of phone numbers, street addresses and name tokens; returns redacted
  string.
- Test: phone, address and a sample name are masked; a clean sentence is unchanged; no
  medication/diagnosis passthrough assertion on a sample.

### Task 9 — inputs_hash helper (15 min)
- Files: `lambdas/triage/audit.py`, `lambdas/triage/test_audit.py`.
- `inputs_hash(rule_inputs: dict) -> str` = SHA-256 of canonical JSON (sorted keys).
- Test: stable across key order; different inputs → different hash.

---

## Phase D — Lambda handlers (moto / stubbed clients)

### Task 10 — dialer handler (45 min)
- Files: `lambdas/dialer/handler.py`, `lambdas/dialer/test_handler.py`.
- Load resident, check allow-list, place Connect contact with the five attributes, write
  `Calls` item with token + `expires_at`; skip path writes `SKIPPED_NOT_ALLOWLISTED`.
- Test: moto DynamoDB; Connect client stubbed — allowed number calls Connect once and
  writes QUEUED; non-listed number does NOT call Connect and writes the skip status;
  `expires_at` ≈ now+24h.

### Task 11 — lex_hook extraction module (45 min)
- Files: `lambdas/lex_hook/extract.py`, `lambdas/lex_hook/test_extract.py`.
- Build Converse request (temperature 0, model from `BEDROCK_EXTRACT_MODEL_ID`), parse and
  validate via `models.py`.
- Test: injected fake Bedrock client returns valid JSON → parsed model; returns malformed
  JSON → fields downgraded to unsure; asserts temperature 0 in the request.

### Task 12 — lex_hook handler + completion (45 min)
- Files: `lambdas/lex_hook/handler.py`, `lambdas/lex_hook/complete.py`,
  `lambdas/lex_hook/test_handler.py`.
- Each turn: redact → extract → fill slots; distress≠none → `route=EMERGENCY`, close;
  all slots filled → write `Calls`, `SendTaskSuccess`, `PutEvents checkin.completed`.
- Test: moto DynamoDB; Step Functions + EventBridge stubbed — emergency turn sets
  `route=EMERGENCY` and does not re-ask; full turn calls SendTaskSuccess once and emits
  the event; asserts raw transcript is never written (only redacted).

### Task 13 — triage_step handler (45 min)
- Files: `lambdas/triage/handler.py`, `lambdas/triage/test_handler.py`.
- Decide via `rules.py`, persist triage/rule_id to `Calls`, create `Tasks`, write `Audit`
  with `rule_id` + `inputs_hash`; return triage to the SM; welfare mode path.
- Test: moto for all tables — URGENT path writes alert task + audit with rule_id and a
  hash; audit contains no transcript/diagnosis fields; welfare mode writes WELFARE_CHECK.

### Task 14 — compute_wait logic (20 min)
- Files: `lambdas/triage/wait.py`, `lambdas/triage/test_wait.py`.
- `retry_wait(time_scale)` and `recheck_wait(extracted, time_scale)` per design §4.1
  (half runway, 30-min floor, 4h if power off), returning integer seconds.
- Test: 6h battery, scale 1 → 10800 s; 1h battery → 1800 s floor; power off → 14400 s;
  scale 60 divides each.

---

## Phase E — Orchestration Lambdas

### Task 15 — callwave_query (20 min)
- Files: `lambdas/orchestration/callwave_query.py`,
  `lambdas/orchestration/test_callwave_query.py`.
- Query `Residents.gsi_zone` for a zone, ascending `risk_tier`, return ordered residents.
- Test: moto — seed mixed tiers, assert tier-1 residents come first.

### Task 16 — outage_ended (30 min)
- Files: `lambdas/orchestration/outage_ended.py`,
  `lambdas/orchestration/test_outage_ended.py`.
- List running ResidentCheck executions whose name starts with `<outage_id>-`, stop each.
- Test: Step Functions client stubbed — two running executions for the outage are stopped;
  an execution for a different outage is left alone.

---

## Phase F — State machines + wiring

### Task 17 — ResidentCheck state machine (45 min)
- Files: `infra/stacks/core_stack.py` (ResidentCheck definition),
  `infra/statemachines/resident_check.py` (ASL builder helper if separated).
- Build per design §4.1: `PlaceCall` waitForTaskToken, `TimeoutSeconds: 180`, retry/
  welfare branch, triage Choice, recheck/retry Waits using `SecondsPath`.
- Test: `infra/test_core_stack.py` (Template) — state machine present; assert a 180
  timeout and a Choice with URGENT/HUMAN_REVIEW/NEEDS_HELP/SAFE branches exist in the
  definition string.

### Task 18 — CallWave state machine (30 min)
- Files: `infra/stacks/core_stack.py` (CallWave definition).
- `QueryZone` → Map `MaxConcurrency=3` starting ResidentCheck with name
  `<outage_id>-<resident_id>`.
- Test: Template assertion — Map state with `MaxConcurrency: 3`; StartExecution target is
  the ResidentCheck SM.

### Task 19 — Lambdas + IAM in CareLineCore (45 min)
- Files: `infra/stacks/core_stack.py` (functions, roles, env vars).
- Define all four+ Lambdas with per-function least-privilege roles and the env matrix in
  design §7; use `grant_*` + scoped `PolicyStatement`s.
- Test: Template assertion — one role per function; assert no IAM policy statement has
  `Action: "*"` or `Resource: "*"` on sensitive actions; env vars present per function.

### Task 20 — EventBridge rules (30 min)
- Files: `infra/stacks/core_stack.py` (rules + targets).
- `OutageStartedRule`→CallWave StartExecution (with a scoped role),
  `OutageEndedRule`→outage_ended Lambda, `CheckinCompletedRule` archive/log target.
- Test: Template assertion — three `AWS::Events::Rule` with the correct detail-types and
  targets.

---

## Phase G — Seed data

### Task 21 — seed script (45 min)
- Files: `scripts/seed.py`, `scripts/test_seed.py`, `scripts/data/residents.py` (or
  inline generator), `scripts/data/sites.py`.
- Generate 40 residents (10/15/15 by tier; 20 en / 12 es / 8 hi) across 4 zones,
  `consent=true`, synthetic phones; 5 resource sites; idempotent writes keyed by id.
- Test: moto — run seed, assert 40 residents with the exact tier and language counts,
  4 distinct zones, 5 sites; re-run leaves counts unchanged (idempotent).

---

## Phase H — Verification

### Task 22 — Full local test + synth (30 min)
- Run `pytest` across `lambdas/`, `infra/`, `scripts/` — all green.
- Run `cdk synth` for both stacks — succeeds with a complete context; fails clearly when a
  required context value is omitted.
- Confirm no AWS resources were deployed. Report results and stop for review.
