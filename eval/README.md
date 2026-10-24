# CareCall ranking eval

Runs transcripts through the real call path and checks the triage rule against
`docs/RANKING.md`. Bedrock (`app/understand.extract_facts`) extracts facts; the plain
Python rules (`app/rules.rank_after_call`) decide the level. The eval never lets the
model pick a level, exactly like production.

## Headline metric

`missed_help_now` = cases where the expected rule is a **Help now** rule (R0/R1/R2) but
the decided level was not HELP_NOW. **Target: 0.** The run exits non-zero if it is > 0.

Also reported: exact rule matches, under-escalated (less urgent than expected),
over-escalated (more urgent), median and max Bedrock latency, and extraction failures
(`Extraction.ok` false).

## Run it

Live (calls Bedrock once per case):

```bash
cd backend && AWS_PROFILE=carecall AWS_DEFAULT_REGION=us-east-1 \
  BEDROCK_MODEL_ID=us.amazon.nova-lite-v1:0 .venv/bin/python ../eval/run.py
```

Offline (no AWS; uses each case's `facts` field to test the rules only):

```bash
cd backend && .venv/bin/python ../eval/run.py --offline
```

One case:

```bash
cd backend && BEDROCK_MODEL_ID=us.amazon.nova-lite-v1:0 .venv/bin/python ../eval/run.py --only ruth
```

## Cases

`cases.yaml`: 24 cases. Each has 5 `answers` (replies to the 5 questions in
`lambdas/lex_hook.py` QUESTIONS), `device_group`, `backup_hours_each`, `drive_minutes`,
and the `expected` rule id. An optional `facts` field lets `--offline` skip Bedrock.
Case `rk10` uses `rules.no_answer_decision(2)` (no Bedrock).

Coverage: all 10 RANKING.md cases, the 4 Zone A personas (Daniel R1, Ruth R2 @70min,
Maria R3 @15min, Linh R5), indirect emergencies and not-safe (R0), vague answers (R4),
food-only (R5) and all-OK (R6).

## Output

Prints a per-case table then the summary, and writes `report.json`
(`{model_id, run_at, offline, cases, summary}`). No phone numbers or secrets are written.

## When a case fails

Fix the prompt in `app/understand.py` or the test transcript, or report it. **Never
change an `expected` answer** unless `docs/RANKING.md` says the expectation was wrong, and
write down why in the commit.
