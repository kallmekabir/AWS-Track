# Product: CareLine

CareLine helps Jane, a county public-health duty officer, check on residents who
depend on powered medical equipment during a power outage, before their backup
supplies run out. The workshop scope is four simultaneous calls, five fixed
questions in English, and one priority list/map/drawer dashboard.

- Use `docs/RANKING.md` for calling order, planned round 2 rules and reasons.
  `backend/app/ranking.py` and `app/rules.py` stay pure Python. Bedrock extracts facts; it never ranks.
- Emergency intent or a phrase in a saved answer produces HELP_NOW/R0. Until
  answers are ranked live by Bedrock + rules R0-R6/NA; unclear ones become R4 (a person checks).
  No answer retries after others' first calls; two misses produce HELP_SOON/NA.
- Residents hear only the fixed script from `backend/app/script.py` and the
  repeated safety question needed to elicit A1. Never generate medical advice.
- Be explicit about timing: answers reach the backend after disconnect. Lex
  FreeFormInput cannot switch to Emergency during slot elicitation; saved phrases
  escalate later. A hang-up before attribute copying may lose earlier answers.
- `call_results.rank_call` runs Bedrock fact
  extraction and Python ranking. Supplier time to spare affects R2 and ordering
  exactly as RANKING.md specifies. Hospital travel is not a substitute.
- Only consenting teammates' allow-listed numbers may receive real calls. Persona
  data is synthetic. DRY_RUN is labeled as rehearsal, not proof of real calls.
- Transcripts are short demo data. Do not promise redaction, automatic 24-hour
  deletion, audit tables, callbacks or alert delivery before they are implemented.
  Keep sensitive details outside model inputs and do not add recording.
- Coordinates stay outside Bedrock requests. The map is operator logistics,
  not a medical destination recommendation.
- An operator copilot, multilingual calls, Knowledge Bases and workflow automation are
  historical broader-design ideas, not requirements for this milestone.
- EC2/CloudFront hosts the backend because the workshop blocks IAM role creation.
  Never reinstate code hooks, Lambda deployment or five-table contracts from the
  historical references. `docs/NEXT_STEPS.md` tracks current work and acceptance.
