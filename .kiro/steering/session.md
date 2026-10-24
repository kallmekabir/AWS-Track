---
inclusion: always
---

# Session context (CareLine, AWS hackathon, video due 10:30 AM Sat)

Account limits: the workshop role cannot create IAM roles. Never propose Lambda, Step
Functions, API Gateway-to-Lambda, EventBridge targets, Knowledge Bases, CDK bootstrap,
sam deploy or Lex code hooks. The backend is backend/ (FastAPI) on EC2
i-025ac542a085a7bf0 behind CloudFront https://d1baurlz014iv6.cloudfront.net (basic auth);
/api/* goes to EC2 port 8000. Dashboard is on S3 behind the same CloudFront. Two DynamoDB
tables only: careline-residents (PK id), careline-checkins (PK resident_id, SK at).

Already built and live-tested (PR #3, branch backend/bedrock-extraction):
- backend/app/understand.py: extract_facts(transcript, said_emergency=False) -> Extraction
  {facts, model_id, latency_ms, ok, problems, transcript}. Nova Lite via Converse, forced
  tool record_checkin, temperature 0. Never raises. Reads BEDROCK_MODEL_ID.
- backend/app/rules.py: rank_after_call(facts, resident, drive_minutes) -> Decision
  {level, rule_id, reason, hours_left, time_to_spare, runs_out_at, recheck_at};
  no_answer_decision(missed). Matches docs/RANKING.md.
- 9/9 live Nova transcripts give the expected rule; 50 unit tests pass.

Rules:
- Bedrock extracts facts only; app/rules.py decides levels. Never let the model pick a level.
- docs/RANKING.md is the spec. If you change a rule, change that file in the same commit.
- Never write secrets, phone numbers, AWS keys or the basic-auth password to files, git,
  logs or chat.
- Ask the human before: any AWS delete, CONNECT_DRY_RUN=0, placing a real call, or editing
  Kabir's files (app/models.py, app/main.py, app/seed.py, app/store.py, app/calling.py,
  app/ranking.py, lambdas/lex_hook.py, web/src/App.tsx, web/src/api.ts) unless the task says
  the human already approved.
- Small commits on a branch, PR into main. Run tests with:
  cd backend && .venv/bin/python -m unittest discover -s tests -t .
- **Branch rule from now on: all work goes on finish/bedrock-wiring. Never merge into main,
  never push to main, never open new PRs. Commit and push to origin/finish/bedrock-wiring only.**
- Finish every task by running its "Done when" checks and reporting the real output.
