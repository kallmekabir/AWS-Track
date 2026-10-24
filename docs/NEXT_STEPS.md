# CareCall: what's done and what's next

Claude: read this at the start of every session. Work on the first unchecked task unless I say otherwise, and check tasks off as they finish. Each phase lists questions to ask me before you start it (see `CLAUDE.md`, section 1).

**The two things the demo must show:**

1. One click calls **4 team phones at the same time**.
2. The answers appear on **the dashboard**, ranked, with reasons and countdowns.

---

## Done

- [x] Build plan (Claude doc "CareCall Build Plan")
- [x] Dashboard mockup and a clickable `index.html` prototype
- [x] FastAPI starter in `backend/app/`: residents (GET, POST, PATCH), `POST /outages` (marks people as calling), check-ins, `GET /queue`. Data is kept in memory for now
- [x] `web/src/api.js`: dashboard → backend calls (now `web/src/api.ts`)
- [x] `README.md`, `CLAUDE.md`, `docs/RANKING.md`, this file
- [x] Agent Toolkit for AWS: AWS CLI, profile `carecall` (us-east-1), AWS skills, AWS rules at the end of `CLAUDE.md`
- [x] Phase 1 dialer and DynamoDB storage. No-hook collector uses Connect attributes; script in `app/script.py`; guarded completion and a background checker. Offline tests cover emergency, complete, partial, missed and duplicate results plus DRY_RUN. Console and phone acceptance remain open.

**Why no Lambda:** the workshop account blocks IAM role creation. Himanshu hosts one uvicorn process on EC2 behind CloudFront and creates the DynamoDB tables. The old template is archived at `docs/reference/template.lambda.yaml` for production reference only; do not deploy it.

---

## Phase 1: the calling system (do this now)

### Our AWS choice for calling: Amazon Connect

**Use one service: Amazon Connect.** Do not look at other calling options.

- It places a real phone call from our code with **one API call** (`StartOutboundVoiceContact`).
- It has a **built-in call script editor** (contact flows) for "say this, then listen".
- It **hands the caller to a Lex bot** to hear their answers. Lex comes with Connect (Connect calls them "bots"), so treat Connect and Lex as **one piece**, not a second service.
- A new instance allows **up to 10 calls at once** by default, which is plenty for our 4. AWS can lower this for new accounts, so test early.
- It runs in our AWS account, which counts toward the AWS track.

**Do not use:**

- Connect outbound *campaigns*. Campaign calls are blocked by default and need an AWS quota request. Plain `StartOutboundVoiceContact` does what we need.
- Services that only play a recorded message. We need to hear answers.
- Building our own phone system. It's far too much work for 18 hours.

Docs: [StartOutboundVoiceContact](https://docs.aws.amazon.com/connect/latest/APIReference/API_StartOutboundVoiceContact.html) · [Why outbound calls fail](https://repost.aws/knowledge-center/connect-troubleshoot-outbound-calls)

**Ask me first:** Why does Connect need Lex, and why can't Bedrock do the listening during the call? Why do we pass `residentId` along with each call?

### Tasks

**Status (Oct 24):** outbound calls already succeed. No-hook completion is tested offline. Remaining AWS work is in **`connect/SETUP.md`**: console verification of Lex slots, contact attribute copying, EC2/CloudFront hosting and real-phone acceptance. Five FreeFormInput slots cannot populate A1 from the intent-triggering reply under documented Lex behavior; the repeated-question fallback needs console verification. Check phone tasks off only when a real phone proves them.

- [ ] **1. One phone rings.** Create a Connect instance in our one region and turn on outbound calling. Claim a US direct-dial number (not toll-free) and set it as the outbound caller ID on the queue. Build a flow that says "Hello from CareCall", then call your own phone from the AWS CLI.
  - *Done when:* your phone rings and says hello. Put the instance, flow and queue IDs in `backend/.env`.
  - *Status:* console work. `connect/SETUP.md` steps 1–5 build the real check-in flow directly; the claimed number goes in `CONNECT_SOURCE_NUMBER`, so no queue setup is needed. Test with `POST /residents/r-001/call` instead of the CLI.
- [ ] **2. Teammates as residents.** Add the 4 teammates (with their OK) with `allow_call: true`. Keep their real numbers in a git-ignored file such as `backend/seed.local.json`, never in git.
  - *Done when:* `GET /residents` shows 4 callable teammates and the made-up residents.
  - *Status:* code ready. `app/seed.py` gives teammates' numbers from Parameter Store (`/carecall/phones/<persona>`, SecureString; each teammate adds their own) to the personas Daniel, Ruth, Maria and Linh; run `python -m app.seed --demo` (SETUP.md section 5). Plain `python -m app.seed` loads the CSV, where nobody is callable.
- [ ] **3. `app/calling.py`: 4 calls at once.** Write `start_call(resident)` and `dial_wave(zone)`. `dial_wave` orders the zone with round 1 (`docs/RANKING.md`), takes the first `MAX_LINES`, and starts each call. Refuse anyone without `allow_call`. Save the returned `ContactId` and start time on the resident. Make `POST /outages` call `dial_wave`.
  - *Done when:* clicking `POST /outages` in `/docs` makes all 4 phones ring together.
  - *Status:* code ready. `app/calling.py` starts the 4 calls in parallel, also refuses numbers missing from `DIALER_ALLOW_LIST`, and the dashboard's **Start outage** button calls it.
- [ ] **4. Lex slots + contact attributes.** Create `CareCallCheckIn` (en_US), intent `CheckIn`, slots A1–A5, and `Emergency`. Keep all code hooks off and publish alias **live**. The flow passes `residentId`, sets `answered=yes`, and copies intent and slots to user-defined `intent`, `a1`–`a5` attributes before branching and disconnecting. No recording.
  - *Done when:* console tests prove the dialog and real calls expose the expected attributes. Follow SETUP.md's acceptance matrix; do not claim the first-reply A1 design works without proof. AWS documents that FreeFormInput is only recognized when elicited and cannot switch to Emergency mid-slot.
  - *Status:* console work. The all-FreeFormInput fallback repeats the safety question for A1. Slot values may be lost when a caller hangs up before the flow copies them.
- [ ] **5. Save the 5 answers after disconnect.** `app/call_results.py` fetches Connect attributes, builds a transcript using `app/script.py`, applies emergency / complete / partial / missed-call rules, then saves a check-in and refills the line. `store.transition` checks the contact ID to save once.
  - *Done when:* after four calls, each teammate has a saved transcript in `/queue`. Emergency intent or a phrase in any answer must produce HELP_NOW / R0.
  - *Status:* code tested offline. Complete and partial transcripts become PERSON_CHECK pending Phase 2; no per-turn progress arrives at the API.
- [ ] **6. Keep 4 lines busy and catch missed calls.** `dial_next(zone)` starts the next person whenever a call ends. Two missed calls → rule NA.
  - *Done when:* with `MAX_LINES=2` and four teammates, phone 3 rings when call 1 ends, including with the dashboard closed.
  - *Status:* code tested offline. FastAPI lifespan checks every five seconds; dashboard polls also call the concurrency-safe checker. `DescribeContact.DisconnectTimestamp` ends a contact, with a 300-second `call_started_at` backstop.

**Milestone: the backend is about halfway done.**

---

## Phase 2: understand and rank (the other half)

**Ask me first:** Why does Bedrock return JSON through a forced tool instead of plain text? Why is time to spare a better sort than hours left alone?

- [ ] **7. Update the data shapes** in `app/models.py` to match `docs/RANKING.md` *(partly done: the new `Status` values and the Resident fields calling needs are in; Bedrock's `facts`, `time_to_spare` and `recheck_at` come with tasks 8–11)*:
  - **Resident:** add `device_group` (1–3, replacing `risk_tier`), `backups_on_file`, `backup_hours_each`, `drive_minutes`, `missed_calls`, `contact_id`, `call_started_at`.
  - **Result:** add `level`, `rule_id`, `reason`, `hours_left`, `time_to_spare`, `runs_out_at`, `recheck_at`, `facts`, `transcript`.
  - Replace the `Status` values with `HELP_NOW`, `HELP_SOON`, `PERSON_CHECK`, `NEEDS_SUPPLIES`, `OK_FOR_NOW`, `CALLING`, `NOT_CALLED`.
- [ ] **8. `app/call_results.py:extract_facts(transcript)`: Bedrock.** Replace its current `None` placeholder by wiring the existing `app/understand.py` extraction helper. Its forced-tool request, normalization and error handling have offline tests; the collector integration is still pending. Converse API with the forced `record_checkin` tool, temperature 0, model from `BEDROCK_MODEL_ID`.
  - *Done when:* 5 typed transcripts, including a messy one, each return valid JSON in the exact shape.
- [ ] **9. `app/ranking.py` and `eval/run.py`.** Round 1 and round 2 exactly as in `docs/RANKING.md`, with no AWS calls inside. The eval runs the 10 test cases. *(Round 1 is in app/ranking.py. Round 2 exists in app/rules.py with offline tests for the worked example and edge cases; call-result integration and eval/run.py are still pending.)*
  - *Done when:* 0 missed "Help now" cases.
- [x] **10. `app/location.py`: Amazon Location implementation.**
  - Geocode a new resident's address when coordinates are omitted, with `IntendedUse=Storage`. Supplied CSV coordinates are retained; AWS positions are longitude first.
  - Use all six hospitals from `data/Hospital_clean.csv` as origins, replacing made-up oxygen suppliers. `GET /hospitals` exposes the same data to the map.
  - `calculate_route_matrix` (hospitals → residents, Car, DepartNow) saves the shortest reachable `drive_minutes`, hospital ID, calculation time and cache key. Batched requests obey the unbounded matrix limits. Failed routes remain unknown.
  - New residents and address/coordinate edits calculate drives with `LOCATION_ENABLED=1`. `POST /locations/refresh?zone=A` backfills existing residents; `force=true` updates the traffic snapshot. Dashboard polls only read the cache.
  - Offline tests cover CSV validation, coordinate order, geocoding, route selection, batching, cache invalidation, API integration and concurrent call updates. The dashboard shows hospital pins and the selected resident's nearest hospital and cached drive.
  - **Live acceptance still open:** enable Location on EC2 and refresh the registry; verify every reachable resident has a position and drive time with the real AWS account. See README's hospital location setup. Hospital oxygen availability is not asserted by this dataset.
- [ ] **11. Connect it all in `call_results.finish_call`.** After disconnect and five answers, through `extract_facts`: understand → drive time (cached) → rank → save result → SNS email if "Help now" → `dial_next`.
  - *Done when:* a real call ends with a ranked result in `GET /queue`.
- [ ] **12. `GET /queue` uses the new order:** level, then least time to spare.

---

## Phase 3: the dashboard, live

**Ask me first:** Why poll every 3 seconds instead of WebSockets? Why must every level show its reason?

- [ ] **13.** Load `GET /queue` and `GET /residents` every 3 seconds. Show the level pill, reason, and a countdown to `runs_out_at`. *(Started: `web/src/layout/Dashboard.tsx` polls `/queue` every 3 s; the ranked list (`web/src/priority/`) shows the level pill, rule + reason, call state (answers arrive after disconnect), and a backup gauge with a ticking countdown to `runs_out_at`. Tested with a dry-run backend and hand-entered check-ins.)*
- [ ] **14. Map with Amazon Location tiles.** This needs a map library in the browser (MapLibre is the usual one), so ask me before adding it. Use a browser API key limited to map actions. *(Started: MapLibre approved Oct 23. `web/src/map/` shows every resident as a pin colored by level and numbered by place in line; clicking a pin opens their details. All six CSV hospitals now have labeled pins with name/address popups. Live map acceptance remains open.)*
- [ ] **15. Detail panel:** what they said, Bedrock's facts, the rule ID, and the time to spare. *(Started: `web/src/drawer/` shows what they said (after a call ends), the rule and reason, the backup countdown, supplier drive, missed calls and Call again. Bedrock's facts and time to spare need Phase 2 fields in `/queue`.)*
- [ ] **16. Start outage button** calls `POST /outages`. The Acknowledge button saves who acknowledged. *(Start outage and "Call again" are in; Acknowledge isn't yet.)*

---

## Phase 4: put it on AWS

- [ ] **17.** Switch `app/store.py` to DynamoDB, keeping the same function names. *(Code ready and tested on DynamoDB Local. Himanshu creates Residents (PK id) and Checkins (PK resident_id, SK at); names come from env. Without `RESIDENTS_TABLE` the store still runs in memory.)*
- [ ] **18.** Himanshu hosts the backend on EC2: install only `backend/requirements.txt`, load `/etc/careline/backend.env`, run `uvicorn app.main:app --host 0.0.0.0 --port 8000` from backend/. CloudFront `/api/...` strips `/api` before proxying. Run one worker; verify background completion without a dashboard. No role creation or template deployment.
- [ ] **19.** Host the dashboard behind CloudFront (`web/dist/`), build with `VITE_API_URL=https://<cloudfront>/api`, and add the CloudFront URL plus `http://localhost:5173` to comma-separated `ALLOWED_ORIGINS`.
- [ ] **20.** Set up the SNS topic and subscribe the "medical team" email.

## Phase 5: the video (by 9:30 AM Saturday)

- [ ] **21.** 5-minute video:
  1. Jane's problem (30 s)
  2. Architecture (45 s)
  3. Live demo: 4 phones ring, answers come in, ranked list with time to spare (2 min 30 s)
  4. Bedrock's facts and the rule that ranked each person (45 s)
  5. Team contact (10 s)

---

## Stretch: only if Phase 1–4 are done, and ask me first

- Bedrock writes a 3-sentence zone summary for Jane.
- A readiness call wave *before* a planned shutoff ("Is your battery fully charged?").
- Nova Sonic voice for a more natural-sounding bot.
- Connect contact events for exact no-answer detection.

---

## Decisions log

Add a line whenever we decide something, so nobody has to ask twice.

| Date | Decision | Why |
| --- | --- | --- |
| Oct 24 | All six `Hospital_clean.csv` hospitals replace fictional supplier origins | User-selected dataset; use shortest hospital-to-resident drive, without assuming oxygen availability |
| Oct 24 | Location calculations are opt-in with `LOCATION_ENABLED=1`; cached drives refresh explicitly | Preserve offline demos and keep 3-second dashboard polls free of route charges; expose calculation time for the traffic snapshot |
| Oct 23 | Python FastAPI backend, Vite + React dashboard | Team skills; FastAPI gives free test pages at `/docs` |
| Oct 23 | English only, AWS-only services | Time; AWS track |
| Oct 23 | Amazon Connect for calls, 4 lines at a time | Real calls from one API call; 4 = our team's phones |
| Oct 23 | Two-round ranking with time to spare (drive time from Amazon Location) | Our main difference from other teams |
| Oct 23 | Region **us-east-1** (was us-west-2) | Matches the hackathon account, the teammates' scaffold and the Location map key |
| Oct 24 | FastAPI runs as one long-lived uvicorn process on EC2 behind CloudFront | Workshop denies IAM role creation; no service can use WSParticipantRole |
| Oct 24 | DynamoDB table names come from env; Himanshu creates both tables | Persist registry and completed check-ins across EC2 restarts |
| Oct 24 | No Lambda or SAM deployment in the workshop; archive the template as production reference | IAM role creation is denied |
| Oct 23 | Lex bot uses a published version + `live` alias | TestBotAlias allows only 2 voice calls at once; we need 4 |
| Oct 24 | Ended calls: DescribeContact disconnect timestamp; background checks plus polls; 300-second start-time backstop | Calls finish with no dashboard open and no per-turn activity |
| Oct 23 | Calls need `allow_call` **and** a number on `DIALER_ALLOW_LIST`; API responses mask phones | A typo or a public URL can never ring a stranger or leak teammates' numbers |
| Oct 23 | Teammates' numbers live in Parameter Store (SecureString, `/carecall/phones/<persona>`), entered by each teammate; they count as allow-listed | Numbers never go into chat, files, git or Claude; one source for personas and the allow-list |
| Oct 23 | Teammates play the personas Daniel, Ruth, Maria, Linh | The dashboard then matches the worked example in `docs/RANKING.md` |
| Oct 23 | Emergency detection uses phrases, not the bare word "help" | Question 5 invites "help with groceries" |
| Oct 23 | `StartOutboundVoiceContact` IAM permission uses `Resource: "*"` | The action has no resource-level permissions (AWS service reference); `DescribeContact` is scoped to our instance |
| Oct 23 | Dashboard is one screen: ranked list, map, one person's details. The CareLine copilot, task, call-log and fairness panels were removed | CLAUDE.md section 3; none had a CareCall endpoint |
| Oct 23 | Dashboard packages: `maplibre-gl` for the map; Barlow fonts bundled with `@fontsource` | MapLibre draws Amazon Location tiles in the browser (task 14); bundled fonts mean no calls to a font service |
| Oct 23 | Dashboard mock mode: `VITE_USE_MOCKS=true` in `web/.env.local`, or `?mock` in the address | Rehearse the screen without the backend or phones; `web/src/mock/` answers in the same shapes as `api.ts` |
| Oct 24 | Lex CheckIn slots + Connect contact attributes replace the code hook; Phase 2 goes in extract_facts | No execution role required; FreeFormInput entry/interrupt limitations are recorded in SETUP.md |
| Oct 24 | Keep all five FreeFormInput slots and repeat the safety question for A1 | FreeFormInput cannot capture the intent-triggering reply; selected workshop fallback |
