# CLAUDE.md — how to work on CareCall

CareCall calls people whose medical devices need electricity during a power outage, 4 phones at a time. It turns their answers into facts with Amazon Bedrock, ranks them with simple written rules, and shows the ranked list on one dashboard. Read `README.md` for the full product description.

**Three files to keep open:**

- `README.md`: what we are building and why.
- `docs/RANKING.md`: the exact ranking rules. Code must match it.
- `docs/NEXT_STEPS.md`: what's done and what's next. Start every session by reading it, and check off tasks as they finish.

---

## 1. How to work with me

I am learning while we build. I want to understand every piece, not just get working code.

1. **Plan first.** Use plan mode for any task that touches more than one file, adds an AWS service, or changes the ranking. Small single-file fixes can skip it.
2. **Quiz me before you finish a plan.** Ask 1–3 short questions, and at least one must be a "why" question about a tool or design choice. Wait for my answer. If I'm wrong or unsure, explain in 2–3 plain sentences, then continue. Example questions:
   - Why do we use Amazon Connect instead of placing calls from Python directly?
   - Why does Bedrock only pull out facts while Python rules do the ranking?
   - Why measure drive time with Amazon Location instead of straight-line distance?
   - Why 4 calls at a time instead of all 40 at once?
   - Why store `runs_out_at` instead of only `hours_left`?
   - Why does the dashboard ask for new data every 3 seconds instead of using WebSockets?
3. **Small steps, each with a test.** Every step ends with a way to see it working: a button in `http://localhost:8000/docs`, a `curl` command, a phone ringing, or a row on the dashboard.
4. **Plain words.** No buzzwords. The first time an AWS term comes up, explain it in one sentence.
5. **Show, then explain.** Make focused edits, not whole-file rewrites. After an edit, say in 2–4 bullets what changed and why.
6. **Ask before adding anything new.** Before adding an AWS service, Python package or npm package, tell me what job it does, which simpler option it beats, and wait for a yes. If a tool is not in the table in section 4, it needs my yes.
7. **Keep the docs true.** When a task in `docs/NEXT_STEPS.md` is done, check it off. If you change a rule, update `docs/RANKING.md` in the same step.

---

## 2. Our design shift (why the project looks like this)

We started with a bigger plan called CareLine. We cut it down so a small team can finish it in about 18 hours and so a stressed duty officer can understand it in 5 seconds.

| Before (CareLine plan) | Now (CareCall) | Why we changed |
| --- | --- | --- |
| English, Spanish and Hindi | English only | Each language is a separate bot setup and set of tests. Not worth it for the demo |
| Knowledge Bases, Guardrails, Step Functions, EventBridge, CDK | Removed from the MVP | Each adds setup time without changing what the judges see |
| Claude models on Bedrock | Amazon Nova on Bedrock | AWS's own model, no extra access form, fits our AWS-only rule |
| Calls one by one, triage only | **4 calls at a time** and **two ranking rounds** with **time to spare** | This is what makes us different: we rank by who runs out first |
| Map with no distance | **Amazon Location drive time** from the nearest supplier | Distance changes who needs help first |
| Many dashboard panels | **One screen**: map, ranked list, one person's details | Jane must see who to help next at a glance |
| Spreadsheet-style statuses | Plain levels: Help now, Help soon, A person must check, Needs supplies, OK for now | Words a non-technical person reads instantly |

**Rule of thumb:** if a feature does not help Jane decide who to help next, it is not in the MVP.

---

## 3. Keep it simple: product design rules

- **One screen.** Map, ranked list, and the selected person's details. No extra pages for the MVP.
- **Plain words on screen.** "Help now", "Runs out at 6:15 PM", "50 min to spare", "No answer (2 tries)". Never internal codes alone.
- **Every place in line shows its reason** in words, plus the rule ID (for example "R2 · supplier 70 min away, 50 min to spare").
- **Color always comes with a word.** Red alone means nothing to a colorblind user.
- **Only the buttons Jane needs:** Start outage, Acknowledge, Call again, Request welfare check.
- **Big, calm, readable.** Buttons at least 44 px tall. One accent color. Red only for "Help now".
- **Show the AI's work.** For each person, show what they said, the facts Bedrock pulled out, and the rule that ranked them. This is what builds trust, and it is what the judges need to see.

---

## 4. Every tool has one job

Priority order for AWS: **1. Amazon Connect (calls) → 2. Amazon Bedrock (understanding) → 3. Amazon Location Service (where and how far) → 4. everything else.**

| Tool | Use it for | Do not use it for |
| --- | --- | --- |
| Amazon Connect | Placing calls (`StartOutboundVoiceContact`) and running the call script (contact flow) | Ranking or storing data |
| Amazon Lex V2 | Hearing each answer and handing the text to `lex_hook` | Understanding meaning (that's Bedrock) |
| Amazon Bedrock (Amazon Nova) | Turning a call transcript into facts (Converse API, tool use, temperature 0). Optional: a short zone summary for Jane | Deciding levels or who is safe |
| Amazon Location Service | Address → map position (`geo-places` `geocode`); drive time from suppliers to residents (`geo-routes` `calculate_route_matrix`); map tiles on the dashboard (`geo-maps`) | Anything that isn't about places |
| AWS Lambda | Running our Python (`api`, `lex_hook`) | Long-running jobs |
| Amazon API Gateway | Giving the FastAPI app a web address | Business logic |
| Amazon DynamoDB | Residents, call results, suppliers | Files or images |
| Amazon SNS | The "Help now" alert email | Talking to residents |
| AWS Amplify Hosting | Hosting the built dashboard (`web/dist/`) | The backend |
| FastAPI + Pydantic | The backend API and checking request shapes | Lex events (`lex_hook` is a plain handler) |
| Vite + React | The dashboard: React draws it, Vite runs and packages it | Backend logic |
| boto3 | Talking to AWS from Python | — |
| AWS SAM | Building and deploying both Lambdas, the HTTP API and the DynamoDB tables (`backend/template.yaml`) | Connect, Lex and the contact flow (console steps in `connect/SETUP.md`) |

---

## 5. AWS priorities in detail

### Bedrock must do real, visible work

Using Bedrock is the entry ticket for this track, so it must be central and visible in the demo.

- **Where:** `app/understand.py`, called once per finished call from `lex_hook`.
- **How:** the Converse API with a forced tool (`record_checkin`), so Bedrock must return JSON in our exact shape. Temperature 0.
- **Model:** an Amazon Nova text model. Read the ID from the `BEDROCK_MODEL_ID` environment variable; never hard-code it.
- **Output shape:** defined in `docs/RANKING.md` ("What Bedrock returns").
- **Never** let Bedrock pick the level. It extracts facts; `app/ranking.py` decides.

### Amazon Location is how distance enters the ranking

- **When a resident is added:** geocode the address and save the map position. Amazon Location returns positions as `[longitude, latitude]`, so be careful with the order. We store the result, so check the `IntendedUse` setting and its pricing in the docs before calling.
- **Before ranking:** for each resident, find the drive time in minutes from each supplier with `calculate_route_matrix` (origins = suppliers, destinations = residents). Keep the shortest. Cache it on the resident, because addresses don't move during an outage.
- **On the dashboard:** map tiles from the Amazon Location Maps API with a browser API key (`VITE_LOCATION_API_KEY`) limited to map actions only.

---

## 6. The calling system: "the agent calls 4 phones at a time"

**Be precise about who does what.** Bedrock cannot place phone calls. When we say "the agent calls people", we mean these pieces working together:

1. `POST /outages` runs **round 1 ranking** (`docs/RANKING.md`) to put the zone's residents in calling order.
2. `app/calling.py` takes the first **4** people (`MAX_LINES=4`) and calls `connect.start_outbound_voice_contact` once per person, back to back. The calls start within a second of each other, so all 4 phones ring together. It passes `residentId` as a contact attribute so later steps know who is on the line.
3. **Amazon Connect** rings the phone and runs our contact flow, which hands the call to the **Lex bot**.
4. For each answer, Lex calls **`lex_hook`**. It saves the answer and asks the next of the 5 questions. After the last question it runs Bedrock → Location drive time → round 2 ranking → saves the result → sends an SNS alert if the level is "Help now".
5. When a call ends (answered, or no answer after `NO_ANSWER_SECONDS`), `calling.dial_next(zone)` starts the next person, so 4 lines stay busy until everyone is reached.

**Rules for `app/calling.py`:**

- **Refuse to call anyone whose `allow_call` is false, or whose number is not in `DIALER_ALLOW_LIST`.** No exceptions. This keeps us to consenting teammates only. An empty allow-list means no real calls at all.
- Never have more than `MAX_LINES` calls marked `CALLING` at once. Status changes go through `store.transition()`, a conditional write, so two Lambdas can never both handle the end of the same call.
- Save the `ContactId` Connect returns on the resident, with the time the call started.
- Throttling: the Connect client retries a throttled request once (boto3 standard retry mode, 2 attempts), and a fresh `ClientToken` per call makes that retry safe (never two calls).
- **No answer:** `check_calls()` runs on each dashboard poll. It asks Connect's `DescribeContact` whether the call has ended, and a call with no new answer after `NO_ANSWER_SECONDS` also counts as ended. An ended call with no answers is a missed call; two missed calls → rule NA in `docs/RANKING.md`. (Connect contact events through EventBridge would be the push-based version. Ask me before adding them.)
- The contact flow must use the Lex bot's **`live` alias**, never TestBotAlias, which allows only 2 voice calls at once.
- API responses mask phone numbers (`ResidentOut`), because the deployed URL is public.
- Do not use Amazon Connect outbound *campaigns*. Campaign calls are blocked by default and need an AWS quota request. Plain `StartOutboundVoiceContact` does what we need.

**Where we are:** once the 4-at-a-time calls work end to end (phones ring, answers reach `lex_hook`), the backend is about **halfway done**. The other half is turning the answers into facts with Bedrock and ranking them (`app/understand.py`, `app/ranking.py`, `app/location.py`).

---

## 7. Ranking in short

The full spec is in `docs/RANKING.md`; this is the summary.

- **Round 1, before calling:** device group first (1 = oxygen machines and ventilators, 2 = dialysis and infusion pumps, 3 = other). Then fewer backups on file first.
- **Round 2, after the call:** rules R0–R6 and NA give each person a level. Inside a level, the person with the **least time to spare** goes first.
- **Time to spare** = hours left − drive time from the nearest supplier.
- `ranking.py` must be plain Python with no AWS calls inside it, so `eval/run.py` can test it without the internet.

---

## 8. Safety rules (never break these)

- Only call phones with `allow_call: true`. All data is made up.
- Bedrock extracts; rules decide. Show the rule ID with every level.
- The call script only asks questions. On any emergency words: tell the person to hang up and call 911, and mark them "Help now".
- No diagnoses or medication names stored. Transcripts are short and for the demo only.
- No secrets in git. AWS IDs and keys live in `.env` files, which are git-ignored. Keep `.env.example` up to date with variable names only.
- CORS: allow `http://localhost:5173` and our Amplify address only.

---

## 9. Commands

```bash
# Backend: from backend/
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --env-file .env   # http://localhost:8000/docs
python -m unittest discover -s tests -t .        # backend tests, no AWS needed
python -m app.seed                               # write the demo roster to DynamoDB

# Deploy the backend: from backend/ (full order in connect/SETUP.md)
sam build && sam deploy --guided --profile carecall --region us-east-1
sam logs -n LexHookFunction --stack-name carecall-backend --profile carecall --tail

# Dashboard: from web/
npm run dev                              # http://localhost:5173
npm run build                            # writes web/dist/ for Amplify

# Ranking tests (once eval/ exists): from repo root
python eval/run.py

# Quick API checks
curl http://localhost:8000/queue?zone=A
curl -X POST http://localhost:8000/outages -H "Content-Type: application/json" -d '{"zone":"A"}'
curl -X POST http://localhost:8000/residents/r-001/call      # ring one phone
curl -X POST "http://localhost:8000/demo/reset?zone=A"       # back to "not called yet"
```

Set `CONNECT_DRY_RUN=1` in `backend/.env` to pretend to call (fake contact IDs, no phone rings).

## 10. Environment variables (`backend/.env`)

Copy `backend/.env.example`; it explains each variable. On AWS, `template.yaml` sets the same variables on both Lambdas.

```text
AWS_PROFILE=carecall
AWS_DEFAULT_REGION=us-east-1        # one region for everything; must match the Connect instance
RESIDENTS_TABLE=                    # from the sam deploy outputs; empty = in-memory demo data
CHECKINS_TABLE=
CONNECT_INSTANCE_ID=
CONNECT_CONTACT_FLOW_ID=
CONNECT_SOURCE_NUMBER=              # the claimed +1 number; it's the caller ID
CONNECT_QUEUE_ID=                   # only if CONNECT_SOURCE_NUMBER is empty
DIALER_ALLOW_LIST=                  # teammates' numbers, comma-separated (python -m app.seed prints it)
CONNECT_DRY_RUN=                    # 1 = fake calls
MAX_LINES=4
NO_ANSWER_SECONDS=120
RING_TIMEOUT_SECONDS=20
ALLOWED_ORIGINS=http://localhost:5173
BEDROCK_MODEL_ID=                   # Phase 2: an Amazon Nova text model ID from the Bedrock console
SNS_TOPIC_ARN=                      # Phase 2
```

Use `AWS_DEFAULT_REGION`, not `AWS_REGION`: boto3 on your laptop only reads `AWS_DEFAULT_REGION` (Lambda sets the region by itself).

Dashboard (`web/.env.local`, git-ignored): `VITE_API_URL`, `VITE_LOCATION_API_KEY`.

## 11. Project layout

```text
backend/
  app/main.py          FastAPI routes (the api Lambda: handler app.main.handler)
  app/models.py        Pydantic data shapes
  app/store.py         Storage: DynamoDB when RESIDENTS_TABLE is set, else in memory (same functions)
  app/seed.py          Demo roster + teammates' phones from seed.local.json (git-ignored)
  app/calling.py       Amazon Connect: 4 calls at a time, dial_next(), check_calls()
  app/understand.py    Bedrock: transcript → facts                              (Phase 2)
  app/ranking.py       Round 1 (done) and round 2 (Phase 2) rules, no AWS calls inside
  app/location.py      Amazon Location: geocode, drive time                     (Phase 2)
  lambdas/lex_hook.py  Lex code hook: asks the questions, saves each answer, then (Phase 2) understand → rank
  tests/               unittest tests with a fake Connect client
  template.yaml        SAM: both Lambdas, the HTTP API, the DynamoDB tables
connect/SETUP.md       Connect instance, Lex bot, contact flow, deploy, seed (in order)
web/src/api.ts         Every dashboard → backend call
web/src/App.tsx        The one-screen dashboard
eval/run.py            Test transcripts through understand + ranking
docs/RANKING.md        Ranking spec
docs/NEXT_STEPS.md     Task list
```

<!-- BEGIN AWS Agent Toolkit rules -->
# AWS Guidance

- Where these AWS rules conflict with the project's own instructions, the
  project's instructions take precedence.
- Prefer the AWS MCP Server for AWS interactions — it provides sandboxed
  execution, observability, and audit logging. If unavailable, use the
  AWS CLI directly.
- Before starting a task, check whether a relevant AWS skill is available.
  Load the skill with `retrieve_skill` and prefer its guidance over
  general knowledge.
- When uncertain about specific AWS details (API parameters, permissions,
  limits, error codes), verify against documentation rather than guessing.
  State uncertainty explicitly if you cannot confirm.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or
  CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework
  principles.
- Do not use em dashes in AWS resource names or descriptions. Use
  hyphens instead.

## Secret Safety

- MUST load the `aws-secrets-manager` skill first for any secret,
  credential, API key, token, or password task. MUST NOT call
  `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST
  NOT hit the Secrets Manager Agent daemon directly. MUST use
  `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with
  `asm-exec` so the secret resolves at runtime without entering context.
<!-- END AWS Agent Toolkit rules -->
