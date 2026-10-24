# Repository structure

```text
backend/
  app/main.py          FastAPI routes and background-checker lifespan
  app/models.py        Registry, live-state and API data shapes
  app/store.py         DynamoDB or memory; guarded transitions and check-ins
  app/calling.py       Connect dialer, line filling, disconnect checking
  app/call_results.py  Contact attributes -> transcript -> status; Phase 2 extract_facts hook
  app/script.py        Fixed five questions, closing and emergency phrases
  app/seed.py          Demo roster and optional teammate phones
  app/phones.py        Existing Parameter Store phone lookup
  app/ranking.py       Pure Python round 1 calling order
  app/rules.py         Round 2 rules, tested offline; integration pending
  app/understand.py    Bedrock extraction helper, tested with fakes; integration pending
  app/location.py      Planned supplier drive-time helper, not implemented
  tests/               unittest tests and Connect/store fakes
  .env.example         Runtime configuration keys
  requirements.txt     Complete EC2/local runtime dependencies, including uvicorn
web/                   React + Vite; api.ts, map/, priority/, drawer/
connect/SETUP.md       Lex/Connect console instructions and acceptance limits
infra/                 Recorded infrastructure state, operations and ownership rules
schemas/               Existing extraction schema reference; follow RANKING.md for Phase 2
.plans/                Active workshop task graph and map plan
docs/careline-plan.md  Active implementation plan
docs/NEXT_STEPS.md     Phase and acceptance checklist
docs/RANKING.md        Ranking rules and fixed script contract
docs/infra/            Hosting handoff
docs/reference/       Historical broader plans and template.lambda.yaml; do not execute
lambdas/               Historical scaffold and geo fixtures, no workshop runtime
eval/                  Future transcript/ranking evaluation
kb/                    Historical Knowledge Base placeholder
```

Keep application logic in importable `backend/app/` modules so unittest and the
planned eval can use it directly. There is no `backend/lambdas/` directory, shared
Lambda layer or generated five-table data model. Proposed CSV imports must conform
to the current Resident shape; no imported data is assumed from file presence alone.
