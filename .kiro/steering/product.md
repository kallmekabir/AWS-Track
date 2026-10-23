# Product: CareLine

CareLine helps Jane Doe, a county public-health duty officer, check on every resident
who depends on powered medical equipment during a power outage, before their backup
batteries run out.

Non-negotiable rules for all code in this repo:

- Amazon Bedrock extracts fields, writes operator briefs and answers resident questions.
  It never assigns triage. Triage is decided by the deterministic rules R0–R7 in
  `lambdas/triage/rules.py`.
- Anything unclear or low-confidence goes to a human (rule R4), never to SAFE.
- Residents hear only fixed, reviewed scripts, except grounded Knowledge Base answers
  that pass Bedrock Guardrails.
- Never generate medical advice.
- The operator copilot is read-only. Plans become tasks only after the operator approves.
- Every decision writes an audit record with a `rule_id`. Overrides require a reason.
- No diagnoses, medication names or raw transcripts are stored. Redacted transcripts
  expire after 24 hours.
- All resident data is synthetic. The dialer only calls numbers on the demo allow-list.
