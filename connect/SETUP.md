# Set up the calls: Amazon Connect + Lex + the backend on AWS

Do these steps **in order**: each one needs an ID from the one before. Everything lives in **us-east-1**. Allow about 60–90 minutes the first time. Console button names change now and then; if a label differs, look for the closest match.

**What you end up with:** Jane clicks **Start outage**, and 4 teammates' phones ring at once. A voice asks the 5 questions, and each answer appears on the dashboard as it's spoken.

```text
Dashboard ──► API Gateway ──► api Lambda (FastAPI) ──► DynamoDB
                                  │ StartOutboundVoiceContact (x4, at once)
                                  ▼
                           Amazon Connect ──rings──► teammate's phone
                                  │ contact flow: says question 1, then hands over to Lex
                                  ▼
                           Lex bot (alias "live") ──each answer──► lex_hook Lambda ──► DynamoDB
```

Words used below:

- **Amazon Connect instance:** your own small call center inside AWS. It owns the phone number and the call script.
- **Contact flow:** the call script, built from blocks ("say this", "listen", "hang up").
- **Lex bot:** turns what the caller says into text, then asks our `lex_hook` Lambda what to say next.
- **Alias:** a fixed name (`live`) that points at one published version of the bot.

---

## 0. Before you start

- [ ] Every teammate whose phone will ring has said yes, in writing (the team chat is fine).
- [ ] The AWS CLI and SAM CLI are installed, and you're signed in:
  ```bash
  aws login --region us-east-1 --profile carecall      # browser sign-in, lasts 12 h
  aws sts get-caller-identity --profile carecall       # shows the account
  sam --version                                         # brew install aws-sam-cli, or:
                                                        # uv tool install aws-sam-cli --python 3.13 --no-build
  ```

## 1. Connect instance and phone number (console, ~15 min)

1. AWS console → **Amazon Connect** → region **US East (N. Virginia)** → **Create instance**.
   - Identity: *Store users in Amazon Connect*. Access URL alias: `carecall-demo` (any free name).
   - Create an admin user for yourself. You'll need it to build the flow.
   - Telephony: turn on **Allow outgoing calls**. Incoming calls are optional.
   - Keep the defaults for data storage and create the instance (about 2 minutes).
2. Open the instance and copy its **Instance ID**, the last part of the instance ARN (`…:instance/<this-part>`).
3. Log in to the instance's admin website (the access URL) → **Channels → Phone numbers → Claim a number** → **DID (Direct Inward Dialing)** → **United States** → pick any number → Save. Copy it in `+1…` form.
   - If you see *"You've reached the limit of Phone Numbers"* on the very first number, that's a known limit on new accounts. Ask the AWS mentors **right away**; only AWS Support can lift it.
4. Check the call limit: AWS console → **Service Quotas → Amazon Connect → Concurrent active calls per instance**. It must be **4 or more**.

**Done when:** you have the instance ID and a claimed `+1…` number.

## 2. First deploy of the backend (terminal, ~5 min)

```bash
cd backend
sam build
sam deploy --guided --profile carecall --region us-east-1
```

Answer the prompts:

| Prompt | Answer |
| --- | --- |
| Stack Name | `carecall-backend` |
| ConnectInstanceId | the instance ID from step 1 |
| ConnectContactFlowId | **leave empty for now** (the flow doesn't exist yet) |
| ConnectSourceNumber | the claimed `+1…` number |
| ConnectQueueId | leave empty |
| DialerAllowList | the 4 teammates' numbers, comma-separated, e.g. `+14085551234,+14085555678,…` |
| AllowedOrigins | keep `http://localhost:5173` (add the Amplify URL later) |
| MaxLines / NoAnswerSeconds / RingTimeoutSeconds | keep the defaults (4 / 120 / 20) |
| "ApiFunction has no authentication. Is this okay?" | `y` (demo only; see the note below) |
| Save arguments to configuration file | `y` (saves `samconfig.toml`, which git ignores) |

The last lines print the **Outputs**: `ApiUrl`, `LexHookFunctionName`, `ResidentsTableName` and `CheckinsTableName`. Keep them.

> **Why "no authentication" is acceptable here:** the API can only ring numbers in `DialerAllowList`, and every phone response is masked. Anyone who finds the URL could still ring the 4 of you or reset the demo, so don't show the URL on screen during the video. A shared key on write requests is in NEXT_STEPS.

**Done when:** `curl <ApiUrl>/health` returns `{"ok":true,...}`.

## 3. The Lex bot (console, ~15 min)

1. AWS console → **Amazon Lex** → **Create bot** → **Create a blank bot**.
   - Name `CareCallCheckIn`. IAM: *Create a role with basic Amazon Lex permissions*. Children's privacy law (COPPA): **No**. Idle session timeout: 5 minutes.
   - Language **English (US)**, voice **Joanna** (neural if offered). Keep the confidence threshold at 0.40.
2. Lex asks you to create a first intent. Name it `Placeholder` and give it one sample utterance nobody will say, e.g. `carecall placeholder intent`. Save.
   - *Why:* a bot can't be built with zero intents. Everything people really say lands in **FallbackIntent**, which sends it to our code.
3. Open **FallbackIntent** → **Fulfillment** → advanced options → turn on **Use a Lambda function for fulfillment** → Save intent. Do the same for `Placeholder`, just in case.
4. Click **Build** and wait for "Successfully built".
5. **Bot versions → Create version** (this makes Version 1).
6. **Aliases → Create alias**: name `live`, version **Version 1**.
   - **Do not use TestBotAlias for calls.** It allows only **2 calls at once**, so phones 3 and 4 would fail.
7. Open alias **live → Languages → English (US)** → Lambda function: the `LexHookFunctionName` from step 2, version `$LATEST` → Save.
8. Optional test: attach the same Lambda to **TestBotAlias** (Languages → English (US)) and use the **Test** panel. Type `yes`; the bot should reply *"Is your medical device working right now?"*.

**Done when:** the test reply works and a line like `{"residentId": null, "q": 1, "said": "yes"}` appears in the logs:

```bash
sam logs -n LexHookFunction --stack-name carecall-backend --profile carecall --tail
```

## 4. The contact flow (Connect admin website, ~15 min)

1. AWS console → your Connect instance → **Flows → Amazon Lex** → region us-east-1, bot `CareCallCheckIn`, alias **`live`** → **Add Amazon Lex Bot**. This lets Connect use the bot.
2. In the Connect admin website: **Routing → Flows → Create flow**. Name it `CareCall outbound check-in`.
3. Drag in these blocks and connect them left to right:

| # | Block | Settings |
| --- | --- | --- |
| 1 | **Set logging behavior** | Enable flow logging |
| 2 | **Set voice** | Language English (US), voice **Joanna**, engine Neural |
| 3 | **Get customer input** | **Text-to-speech:** `Hi, this is CareCall from County Public Health, checking on you during the power outage. Are you safe right now?` (word for word, the same as question 1 in `backend/lambdas/lex_hook.py`). **Amazon Lex tab:** bot `CareCallCheckIn`, alias **`live`**. **Session attributes:** add `residentId`, set dynamically: namespace *User defined*, key `residentId` |
| 4 | **Disconnect / hang up** | Connect **every** exit of block 3 (Default, Error, any intent) to here |

   - *Why `residentId`:* the backend starts each call with `Attributes={"residentId": "r-001"}`. Passing it to Lex is how `lex_hook` knows **whose** answers it is saving when 4 calls run at once.
   - Optional: add a second session attribute `x-amz-lex:audio:end-timeout-ms:*:*` = `1500`. It gives people a moment to pause mid-sentence ("about… two hours") before Lex decides they're done.
   - Don't add a **Set recording** block. Call recording stays off (README, Safety and privacy).
4. **Save → Publish.** Under the flow name, open **Show additional flow information** and copy the **flow ID**, the last part of the ARN (`…/contact-flow/<this-part>`).

**Done when:** the flow shows as Published and you have its ID.

## 5. Second deploy: give the backend the flow ID

```bash
cd backend
sam build && sam deploy --guided --profile carecall --region us-east-1
```

Press Enter to keep every saved answer, and paste the flow ID at **ConnectContactFlowId**.

## 6. Put the demo residents in DynamoDB

1. `cp backend/.env.example backend/.env`, then fill in `RESIDENTS_TABLE` and `CHECKINS_TABLE` from the outputs, plus the Connect IDs if you want to place calls from your laptop.
2. `cp backend/seed.local.example.json backend/seed.local.json` and put in the 4 teammates' real numbers. Each teammate plays one persona: Daniel, Ruth, Maria or Linh. This file is git-ignored.
3. Run:
   ```bash
   cd backend && source .venv/bin/activate
   python -m app.seed
   ```
   It prints `DIALER_ALLOW_LIST=…`. That must be the **same numbers** you gave `DialerAllowList` in step 2; if not, redo step 5 with the printed value.

**Done when:** `curl "<ApiUrl>/queue?zone=A"` lists 8 people, all "NOT_CALLED".

## 7. Test: one phone, then four

1. **One phone:** `curl -X POST <ApiUrl>/residents/r-001/call`. Daniel's teammate's phone rings, hears question 1, and answers all 5.
   Expected: `GET /queue` shows Daniel as `PERSON_CHECK` with 5 answers in `transcript`.
2. **Reset:** `curl -X POST "<ApiUrl>/demo/reset?zone=A"`.
3. **Four phones:** run the dashboard (`web/.env.local`: `VITE_API_URL=<ApiUrl>`, then `npm run dev`) and click **Start outage**. All 4 phones ring within a second or two, and the rows show *Ringing… → Question 2 of 5 → …* as people answer.

## Troubleshooting

| What you see | Likely cause → fix |
| --- | --- |
| `503 Calling is not set up: missing …` | A Connect parameter is empty → redo step 5 |
| `403 … not on DIALER_ALLOW_LIST` | The seed numbers and `DialerAllowList` differ → step 6.3 |
| `502 Amazon Connect refused the call: DestinationNotAllowedException` | Outbound calling is off on the instance, or the number's country isn't allowed |
| Phone rings, question 1 plays, then silence or a hang-up | The `live` alias has no Lambda (step 3.7), the FallbackIntent fulfillment hook is off (3.3), or the bot wasn't rebuilt and versioned after the change. Check the `sam logs` from step 3 |
| Phones 1–2 work, 3–4 get a fast busy tone or fail | The flow uses TestBotAlias (2-call limit) instead of `live`, or the concurrent-calls quota is under 4 (step 1.4) |
| Nobody answers and the row stays "Calling now" | The dashboard must be open: it checks for ended calls on each 3-second poll. A missed call becomes "No answer (1 try). Calling again" |
| Dashboard says "Can't reach the CareCall API" | Wrong `VITE_API_URL`, or the dashboard's address isn't in `AllowedOrigins` |

## After judging: clean up (stops the charges)

1. Connect admin website → **Phone numbers** → release the number **first**.
2. AWS console → Amazon Connect → delete the instance.
3. Amazon Lex → delete `CareCallCheckIn`.
4. `cd backend && sam delete --stack-name carecall-backend --profile carecall`. This deletes the Lambdas, the API and both DynamoDB tables.
