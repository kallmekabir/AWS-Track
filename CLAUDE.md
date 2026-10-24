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
| Map with no distance | **Amazon Location drive time** from the nearest hospital in `data/Hospital_clean.csv` | Distance changes who needs help first |
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
| Amazon Lex V2 | Collecting A1–A5 in CheckIn slots; Connect persists them as contact attributes | Understanding meaning (that's Bedrock) |
| Amazon Bedrock (Amazon Nova) | Turning a call transcript into facts (Converse API, tool use, temperature 0). Optional: a short zone summary for Jane | Deciding levels or who is safe |
| Amazon Location Service | Address → map position (`geo-places` `geocode`); drive time from CSV hospitals to residents (`geo-routes` `calculate_route_matrix`); map tiles on the dashboard (`geo-maps`) | Anything that isn't about places |
| Amazon EC2 | Long-lived FastAPI server and background call checker on port 8000 | Collecting voice input |
| Amazon CloudFront | Serving the dashboard and proxying `/api/...` to the backend with `/api` stripped | Business logic |
| Amazon DynamoDB | Residents, call results, suppliers | Files or images |
| Amazon SNS | The "Help now" alert email | Talking to residents |
| FastAPI + Pydantic | The backend API, request validation and a lifespan task for call completion | Speech recognition |
| Vite + React | The dashboard: React draws it, Vite runs and packages it | Backend logic |
| boto3 | Talking to AWS from Python | — |

---

## 5. AWS priorities in detail

### Bedrock must do real, visible work

Using Bedrock is the entry ticket for this track, so it must be central and visible in the demo.

- **Where:** Phase 2 replaces the `extract_facts(transcript)` placeholder in `app/call_results.py`, wiring the existing `app/understand.py` and `app/rules.py` helpers, which have offline tests. It returns `None` today.
- **How:** the Converse API with a forced tool (`record_checkin`), so Bedrock must return JSON in our exact shape. Temperature 0.
- **Model:** an Amazon Nova text model. Read the ID from the `BEDROCK_MODEL_ID` environment variable; never hard-code it.
- **Output shape:** defined in `docs/RANKING.md` ("What Bedrock returns").
- **Never** let Bedrock pick the level. It extracts facts; `app/ranking.py` decides.

### Amazon Location is how distance enters the ranking

- **When a resident is added:** with `LOCATION_ENABLED=1`, geocode the address if both coordinates are omitted and save the position. Amazon Location returns `[longitude, latitude]`. Stored geocodes use `IntendedUse=Storage`; supplied coordinate pairs bypass geocoding.
- **Before ranking:** use all six hospitals from `data/Hospital_clean.csv` as origins and residents as destinations in `calculate_route_matrix`. Keep the shortest reachable drive, hospital ID and calculation time. New residents and location edits calculate automatically; `POST /locations/refresh?zone=A` backfills existing residents, with `force=true` to refresh traffic. Dashboard reads never calculate routes. The CSV does not assert oxygen availability.
- **On the dashboard:** map tiles from the Amazon Location Maps API with a browser API key (`VITE_LOCATION_API_KEY`) limited to map actions only.

---

## 6. The calling system: "the agent calls 4 phones at a time"

**Be precise about who does what.** Bedrock cannot place phone calls. When we say "the agent calls people", we mean these pieces working together:

1. `POST /outages` runs **round 1 ranking** (`docs/RANKING.md`) to put the zone's residents in calling order.
2. `app/calling.py` takes the first **4** people (`MAX_LINES=4`) and calls `connect.start_outbound_voice_contact` once per person, back to back. The calls start within a second of each other, so all 4 phones ring together. It passes `residentId` as a contact attribute so later steps know who is on the line.
3. **Amazon Connect** rings the phone and runs our contact flow, which hands the call to the **Lex bot**.
4. **Lex CheckIn** collects five required slots A1–A5; Connect copies `$.Lex.IntentName` and `$.Lex.Slots.A1..A5` to user-defined `intent` and `a1..a5` attributes. No intent or alias has a code hook. `app/script.py` holds the unchanged script. The FreeFormInput first-reply, emergency-switch and partial-hang-up limits are documented in `connect/SETUP.md`; console/phone acceptance remains open.
5. After `DescribeContact` reports a disconnect, **`app/call_results.py`** fetches contact attributes, saves the transcript and a check-in, then calls `dial_next`. Emergency intent or emergency phrases in any answer → HELP_NOW / R0; five answers → PERSON_CHECK waiting for ranking; some answers → PERSON_CHECK; no answer → missed-call rules. Phase 2 Bedrock goes in `extract_facts`.
6. When a call ends (answered, or the start-time backstop of `NO_ANSWER_SECONDS` expires), `calling.dial_next(zone)` starts the next person, so 4 lines stay busy until everyone is reached.

**Rules for `app/calling.py`:**

- **Refuse to call anyone whose `allow_call` is false, or whose number is not a teammate's number in Parameter Store (`PHONES_SSM_PATH`, see `app/phones.py`) or on `DIALER_ALLOW_LIST`.** No exceptions. This keeps us to consenting teammates only. An empty allow-list means no real calls at all.
- Never have more than `MAX_LINES` calls marked `CALLING` at once. Status changes go through `store.transition()`, a conditional write, with a contact ID guard, so concurrent checkers cannot save the same result twice.
- Save the `ContactId` Connect returns on the resident, with the time the call started.
- Throttling: the Connect client retries a throttled request once (boto3 standard retry mode, 2 attempts), and a fresh `ClientToken` per call makes that retry safe (never two calls).
- **No answer:** `check_calls()` runs every `CHECK_EVERY_SECONDS` (5 seconds) from the FastAPI lifespan task, plus dashboard polls. It uses Connect's `DescribeContact.DisconnectTimestamp` and a `NO_ANSWER_SECONDS=300` backstop measured from `call_started_at`. A lock prevents overlapping checks; no per-turn updates arrive. An ended call with no answers is a missed call; two missed calls → rule NA in `docs/RANKING.md`. (Connect contact events through EventBridge would be the push-based version. Ask me before adding them.)
- The contact flow must use the Lex bot's **`live` alias**, never TestBotAlias, which allows only 2 voice calls at once.
- API responses mask phone numbers (`ResidentOut`), because the deployed URL is public.
- Do not use Amazon Connect outbound *campaigns*. Campaign calls are blocked by default and need an AWS quota request. Plain `StartOutboundVoiceContact` does what we need.

**Where we are:** once the 4-at-a-time calls work end to end (phones ring, slot answers appear in contact attributes and `/queue`), the backend is about **halfway done**. The other half is turning the answers into facts with Bedrock and ranking them (`app/understand.py`, `app/ranking.py`, `app/location.py`).

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
- The call script only asks questions. Emergency entry intent tells the person to hang up and call 911. Emergency words in collected answers mark them "Help now" after disconnect; FreeFormInput cannot switch intents mid-slot.
- No diagnoses or medication names stored. Transcripts are short and for the demo only.
- No secrets in git. AWS IDs and keys live in `.env` files, which are git-ignored. Keep `.env.example` up to date with variable names only.
- CORS: allow `http://localhost:5173` and our CloudFront address only.

---

## 9. Commands

```bash
# Backend: from backend/
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --env-file .env   # http://localhost:8000/docs
python -m unittest discover -s tests -t .        # backend tests, no AWS needed
python -m app.seed --demo                        # teammate roster to DynamoDB; phones can ring
python -m app.seed                               # CSV residents (data/Residents_simple.csv); nobody callable
# add --with-location for drive times, --dry-run to validate without writing

# EC2 backend: from backend/, with /etc/careline/backend.env loaded by the service manager
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Dashboard: from web/
npm run dev                              # http://localhost:5173
npm run build                            # writes web/dist/ for CloudFront hosting

# Ranking tests (once eval/ exists): from repo root
python eval/run.py

# Quick API checks
curl http://localhost:8000/queue?zone=A
curl -X POST http://localhost:8000/outages -H "Content-Type: application/json" -d '{"zone":"A"}'
curl -X POST http://localhost:8000/residents/r-001/call      # ring one phone
curl -X POST "http://localhost:8000/demo/reset?zone=A"       # back to "not called yet"
```

Set `CONNECT_DRY_RUN=1` in `backend/.env` to fake contacts and full five-answer results after five seconds. Consent is still required (`allow_call=true`); no phones ring.

## 10. Environment variables (`backend/.env`)

Copy `backend/.env.example` locally. On EC2, Himanshu supplies `/etc/careline/backend.env` with these keys and creates the DynamoDB tables: Residents PK `id`; Checkins PK `resident_id`, SK `at`. The service manager loads that environment or uvicorn uses `--env-file /etc/careline/backend.env`.

**Why no Lambda:** the workshop account blocks IAM role creation. Do not deploy the historical `docs/reference/template.lambda.yaml`; its removed handlers and packaging would need restoration for production. Run a single uvicorn worker on EC2. CloudFront serves `/api/...` and strips `/api` before forwarding to port 8000.

```text
AWS_PROFILE=carecall
AWS_DEFAULT_REGION=us-east-1        # one region for everything; must match the Connect instance
RESIDENTS_TABLE=                    # created by Himanshu; empty = in-memory demo data
CHECKINS_TABLE=
CONNECT_INSTANCE_ID=
CONNECT_CONTACT_FLOW_ID=
CONNECT_SOURCE_NUMBER=              # the claimed +1 number; it's the caller ID
CONNECT_QUEUE_ID=                   # only if CONNECT_SOURCE_NUMBER is empty
PHONES_SSM_PATH=/carecall/phones    # teammates' numbers: one SecureString per persona, e.g. .../daniel-kim
DIALER_ALLOW_LIST=                  # optional extra allowed numbers; prefer Parameter Store
CONNECT_DRY_RUN=                    # 1 = fake calls
MAX_LINES=4
NO_ANSWER_SECONDS=300
ALLOWED_ORIGINS=https://<cloudfront>,http://localhost:5173
BEDROCK_MODEL_ID=                   # Phase 2: an Amazon Nova text model ID from the Bedrock console
SNS_TOPIC_ARN=                      # Phase 2
LOCATION_ENABLED=0                 # 1 enables geocoding and cached hospital drive calculations
HOSPITALS_CSV=                      # optional override; default data/Hospital_clean.csv
```

Use `AWS_DEFAULT_REGION` for boto3. `AWS_PROFILE=carecall` is for local development; omit it on EC2 if AWS access comes from another mechanism.

Dashboard (`web/.env.local`, git-ignored): `VITE_API_URL=https://<cloudfront>/api` (default `http://localhost:8000`), `VITE_LOCATION_API_KEY`. Rebuild Vite after changing the API URL.

## 11. Project layout

```text
backend/
  app/main.py          FastAPI routes and the background checker lifespan task
  app/models.py        Pydantic data shapes
  app/store.py         Storage: DynamoDB when RESIDENTS_TABLE is set, else in memory (same functions)
  app/seed.py          Demo roster + teammates' phones (Parameter Store, or git-ignored seed.local.json)
  app/phones.py        Reads teammates' numbers from Parameter Store; never prints them
  app/calling.py       Amazon Connect: 4 calls at a time, dial_next(), check_calls()
  app/understand.py    Bedrock: transcript → facts                              (Phase 2)
  app/ranking.py       Round 1 calling order, no AWS calls inside
  app/rules.py         Round 2 rules, tested offline; collector integration pending
  app/location.py      Amazon Location: geocode, CSV hospitals, cached drive times
  app/script.py        Fixed questions, closing text and emergency phrases
  app/call_results.py  Connect attributes → transcript → status; extract_facts is the Phase 2 hook
  tests/               unittest tests with a fake Connect client
connect/SETUP.md       Connect instance, Lex slots, contact attributes, EC2 hosting and acceptance
docs/reference/template.lambda.yaml  Historical production reference; not workshop deployable
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
