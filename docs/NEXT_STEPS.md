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
- [x] Phase 1 code, DynamoDB storage and the SAM template (branch `backend/connect-calling`). Tested without AWS: 18 unit tests, a full run against DynamoDB Local, the API in dry-run mode, and dashboard screenshots

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

**Status (Oct 23):** all Phase 1 code is written and tested offline. What's left is the AWS setup in **`connect/SETUP.md`** (Connect instance, Lex bot, contact flow, `sam deploy`, seed). Check a task off only when a real phone proves it.

- [ ] **1. One phone rings.** Create a Connect instance in our one region and turn on outbound calling. Claim a US direct-dial number (not toll-free) and set it as the outbound caller ID on the queue. Build a flow that says "Hello from CareCall", then call your own phone from the AWS CLI.
  - *Done when:* your phone rings and says hello. Put the instance, flow and queue IDs in `backend/.env`.
  - *Status:* console work. `connect/SETUP.md` steps 1–5 build the real check-in flow directly; the claimed number goes in `CONNECT_SOURCE_NUMBER`, so no queue setup is needed. Test with `POST /residents/r-001/call` instead of the CLI.
- [ ] **2. Teammates as residents.** Add the 4 teammates (with their OK) with `allow_call: true`. Keep their real numbers in a git-ignored file such as `backend/seed.local.json`, never in git.
  - *Done when:* `GET /residents` shows 4 callable teammates and the made-up residents.
  - *Status:* code ready. `app/seed.py` gives teammates' numbers from Parameter Store (`/carecall/phones/<persona>`, SecureString; each teammate adds their own) to the personas Daniel, Ruth, Maria and Linh; run `python -m app.seed` (SETUP.md step 6).
- [ ] **3. `app/calling.py`: 4 calls at once.** Write `start_call(resident)` and `dial_wave(zone)`. `dial_wave` orders the zone with round 1 (`docs/RANKING.md`), takes the first `MAX_LINES`, and starts each call. Refuse anyone without `allow_call`. Save the returned `ContactId` and start time on the resident. Make `POST /outages` call `dial_wave`.
  - *Done when:* clicking `POST /outages` in `/docs` makes all 4 phones ring together.
  - *Status:* code ready. `app/calling.py` starts the 4 calls in parallel, also refuses numbers missing from `DIALER_ALLOW_LIST`, and the dashboard's **Start outage** button calls it.
- [ ] **4. Lex bot hears answers.** Create a Lex V2 bot with an English locale. Turn on the Lambda code hook for its fallback intent so every answer reaches our code. In the contact flow, use "Get customer input" with the bot, and pass `residentId` into the bot's session attributes.
  - *Done when:* saying anything on the call shows up in the `lex_hook` logs in CloudWatch.
  - *Status:* console work, SETUP.md steps 3–4. Publish version 1 and use a **`live` alias**: TestBotAlias allows only 2 calls at once.
- [ ] **5. `lambdas/lex_hook.py`: the 5 questions.** Keep the question number and the transcript so far in session attributes. Ask the next question each turn, and handle emergency words (`docs/RANKING.md`, "The call script"). After question 5, save the transcript for that resident and end the call politely.
  - *Done when:* after 4 calls, each teammate has a saved transcript.
  - *Status:* code ready (`backend/lambdas/lex_hook.py`). Each answer is saved as it's spoken, so the dashboard shows "Question 3 of 5" live. After question 5 the person shows as "A person must check" until Phase 2 ranks them.
- [ ] **6. Keep 4 lines busy and catch missed calls.** `dial_next(zone)` starts the next person whenever a call ends. A call with no result after `NO_ANSWER_SECONDS` counts as missed; 2 misses → rule NA.
  - *Done when:* with `MAX_LINES=2` and 4 teammates, phone 3 rings as soon as call 1 ends.
  - *Status:* code ready. `lex_hook` calls `dial_next` when someone finishes. `check_calls()` catches hang-ups with Connect's `DescribeContact` (the `NO_ANSWER_SECONDS` timer is the backstop); it runs on the dashboard's 3-second poll, so keep the dashboard open. A missed call retries after everyone else's first call.

**Milestone: the backend is about halfway done.**

---

## Phase 2: understand and rank (the other half)

**Ask me first:** Why does Bedrock return JSON through a forced tool instead of plain text? Why is time to spare a better sort than hours left alone?

- [ ] **7. Update the data shapes** in `app/models.py` to match `docs/RANKING.md` *(partly done: the new `Status` values and the Resident fields calling needs are in; Bedrock's `facts`, `time_to_spare` and `recheck_at` come with tasks 8–11)*:
  - **Resident:** add `device_group` (1–3, replacing `risk_tier`), `backups_on_file`, `backup_hours_each`, `drive_minutes`, `missed_calls`, `contact_id`, `call_started_at`.
  - **Result:** add `level`, `rule_id`, `reason`, `hours_left`, `time_to_spare`, `runs_out_at`, `recheck_at`, `facts`, `transcript`.
  - Replace the `Status` values with `HELP_NOW`, `HELP_SOON`, `PERSON_CHECK`, `NEEDS_SUPPLIES`, `OK_FOR_NOW`, `CALLING`, `NOT_CALLED`.
- [ ] **8. `app/understand.py`: Bedrock.** Converse API with the forced `record_checkin` tool, temperature 0, model from `BEDROCK_MODEL_ID`.
  - *Done when:* 5 typed transcripts, including a messy one, each return valid JSON in the exact shape.
- [ ] **9. `app/ranking.py` and `eval/run.py`.** Round 1 and round 2 exactly as in `docs/RANKING.md`, with no AWS calls inside. The eval runs the 10 test cases. *(Round 1 is done and tested; round 2 and the eval are next.)*
  - *Done when:* 0 missed "Help now" cases.
- [ ] **10. `app/location.py`: Amazon Location.**
  - Geocode the address when a resident is added. Remember positions come back as longitude first.
  - Add 3 made-up oxygen suppliers.
  - Use `calculate_route_matrix` (suppliers → residents) to save each resident's shortest `drive_minutes`.
  - *Done when:* every resident has a map position and `drive_minutes`.
- [ ] **11. Connect it all in `lex_hook`.** After question 5: understand → drive time (cached) → rank → save result → SNS email if "Help now" → `dial_next`.
  - *Done when:* a real call ends with a ranked result in `GET /queue`.
- [ ] **12. `GET /queue` uses the new order:** level, then least time to spare.

---

## Phase 3: the dashboard, live

**Ask me first:** Why poll every 3 seconds instead of WebSockets? Why must every level show its reason?

- [ ] **13.** Load `GET /queue` and `GET /residents` every 3 seconds. Show the level pill, reason, and a countdown to `runs_out_at`. *(Started: `web/src/App.tsx` polls `/queue` every 3 s and shows the level pill, rule + reason, live call progress and "Runs out at …"; a ticking countdown comes once Phase 2 fills `runs_out_at`.)*
- [ ] **14. Map with Amazon Location tiles.** This needs a map library in the browser (MapLibre is the usual one), so ask me before adding it. Use a browser API key limited to map actions.
- [ ] **15. Detail panel:** what they said, Bedrock's facts, the rule ID, and the time to spare. *(Started: "What they said" expands each person's answers.)*
- [ ] **16. Start outage button** calls `POST /outages`. The Acknowledge button saves who acknowledged. *(Start outage and "Call again" are in; Acknowledge isn't yet.)*

---

## Phase 4: put it on AWS

- [ ] **17.** Switch `app/store.py` to DynamoDB, keeping the same function names. *(Code ready and tested on DynamoDB Local. Moved up from Phase 4: `lex_hook` runs in its own Lambda, so real calls need shared storage. Without `RESIDENTS_TABLE` the store still runs in memory.)*
- [ ] **18.** Deploy the `api` Lambda (handler `app.main.handler`) behind API Gateway, plus the `lex_hook` Lambda. Give each Lambda only the permissions it uses. *(Code ready: `backend/template.yaml`, deployed with `sam deploy` per SETUP.md step 2.)*
- [ ] **19.** Host the dashboard on Amplify (`web/dist/`) and add its address to the CORS list.
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
| Oct 23 | Python FastAPI backend, Vite + React dashboard | Team skills; FastAPI gives free test pages at `/docs` |
| Oct 23 | English only, AWS-only services | Time; AWS track |
| Oct 23 | Amazon Connect for calls, 4 lines at a time | Real calls from one API call; 4 = our team's phones |
| Oct 23 | Two-round ranking with time to spare (drive time from Amazon Location) | Our main difference from other teams |
| Oct 23 | Region **us-east-1** (was us-west-2) | Matches the hackathon account, the teammates' scaffold and the Location map key |
| Oct 23 | FastAPI stays; it runs inside Lambda through Mangum | No rewrite, and `/docs` still works locally |
| Oct 23 | DynamoDB now, not in Phase 4 | Lex can only call a Lambda; `lex_hook` and the API must share data |
| Oct 23 | AWS SAM (`backend/template.yaml`) for deploys | One command builds and deploys both Lambdas, the API and the tables; CDK was cut from the MVP |
| Oct 23 | Lex bot uses a published version + `live` alias | TestBotAlias allows only 2 voice calls at once; we need 4 |
| Oct 23 | Ended calls: Connect `DescribeContact` on each dashboard poll, plus a `NO_ANSWER_SECONDS` timer | Exact hang-up detection without adding EventBridge contact events |
| Oct 23 | Calls need `allow_call` **and** a number on `DIALER_ALLOW_LIST`; API responses mask phones | A typo or a public URL can never ring a stranger or leak teammates' numbers |
| Oct 23 | Teammates' numbers live in Parameter Store (SecureString, `/carecall/phones/<persona>`), entered by each teammate; they count as allow-listed | Numbers never go into chat, files, git or Claude; one source for personas and the allow-list |
| Oct 23 | Teammates play the personas Daniel, Ruth, Maria, Linh | The dashboard then matches the worked example in `docs/RANKING.md` |
| Oct 23 | Emergency detection uses phrases, not the bare word "help" | Question 5 invites "help with groceries" |
| Oct 23 | `StartOutboundVoiceContact` IAM permission uses `Resource: "*"` | The action has no resource-level permissions (AWS service reference); `DescribeContact` is scoped to our instance |
