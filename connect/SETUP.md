# CareCall: Connect, Lex slots and EC2 setup

**Why no Lambda:** the workshop account denies IAM role creation. `PassRole` is
limited to `WSParticipantRole`, which trusts no AWS service. Connect and Lex use
service-linked roles and outbound calls already work. Run the backend as a
long-lived EC2 process; do not deploy the historical template in
`docs/reference/template.lambda.yaml`.

Use **us-east-1** throughout. Fixed script text lives in `backend/app/script.py`.
Only consenting teammates' allow-listed phones may receive real calls.

## 1. Connect instance and phone number

Reuse the working Connect instance and claimed number where possible.

1. AWS console → **Amazon Connect** → select the instance. If creating one,
   use **Store users in Amazon Connect**, create an admin user and enable
   **Allow outgoing calls**. Keep its service-linked role; do not choose
   `WSParticipantRole` as a service execution role.
2. Copy the **Instance ID** from the instance ARN.
3. Connect admin website → **Channels → Phone numbers**. Reuse or claim a US
   **DID** number and copy it in E.164 form as `CONNECT_SOURCE_NUMBER`.
4. Check **Service Quotas → Amazon Connect → Concurrent active calls per
   instance** permits at least four. If number claiming is blocked, ask the
   workshop mentors; do not switch to outbound campaigns.

## 2. Lex bot without code hooks

### Known constraint and console acceptance check

AWS documents that `AMAZON.FreeFormInput` is recognized only when explicitly
elicited, cannot occur in intent sample utterances, and does not switch intents
while eliciting. Adding `yes` as a sample utterance selects `CheckIn` but does
**not** populate A1 from that first reply. See the
[FreeFormInput reference](https://docs.aws.amazon.com/lexv2/latest/dg/built-in-slot-free-form.html).

Consequently, five FreeFormInput slots cannot satisfy the requested single
safety reply with an ordinary Get customer input entry. The selected all-FreeFormInput
configuration below repeats the safety question to fill A1. This repeats one
question rather than promising unsupported first-reply capture. A custom A1 slot that can be
used in sample utterances, or runtime initialization of slot elicitation, would
require a design change. No console test pane is accessible from this repository
session; record the actual result below before declaring phone acceptance done.

1. AWS console → **Amazon Lex → Create bot → Create a blank bot**.
   Name **CareCallCheckIn**; language **English (US), en_US**; voice **Joanna**,
   neural where available; COPPA **No**; idle timeout five minutes. Reuse the
   Lex service-linked role option. Do not request a new ordinary IAM role.
2. Create intent **CheckIn**. Add sample utterances, one per line:

   ```text
   yes
   no
   I'm okay
   not really
   I'm fine
   kind of
   yes I am safe
   no I'm not safe
   I am alright
   I'm doing okay
   everything is fine
   I don't know
   I am not sure
   ```

   Do not use `{A1}` in sample utterances with FreeFormInput: Lex forbids it.
3. Add five **required** slots, all type **AMAZON.FreeFormInput**, with priority
   **A1, A2, A3, A4, A5**. No initial response or confirmation question.
   A1's fallback prompt is `Are you safe right now?`; A2–A5 match
   `script.QUESTIONS[2]` through `[5]` word for word:

   | Slot | Prompt |
   | --- | --- |
   | A1 | Are you safe right now? |
   | A2 | Is your medical device working right now? |
   | A3 | How many full backup tanks or batteries do you have? |
   | A4 | About how many hours can you go before you run out? |
   | A5 | Do you need anything else, like medicine, food, a ride, a place to charge, or an oxygen delivery? |

   Keep a single retry on no input with `Sorry, I didn't catch that. ` followed
   by the same question. Configure slot-failure paths to close the conversation
   rather than collecting later answers into the wrong slot.
4. **CheckIn → Closing response**:

   ```text
   Thank you. Our team has your answers. If anything changes or you feel unsafe, hang up and call 911.
   ```

5. Create intent **Emergency**, no slots, with every `EMERGENCY_PHRASES` entry
   plus variants (one per line):

   ```text
   can't breathe
   cannot breathe
   can not breathe
   not breathing
   chest pain
   heart attack
   emergency
   ambulance
   call 911
   nine one one
   help me
   i fell
   i've fallen
   I can't breathe
   I cannot breathe
   I'm having chest pain
   I'm having a heart attack
   this is an emergency
   send an ambulance
   please call 911
   please help me
   I have fallen
   ```

   **Emergency → Closing response**:

   ```text
   Please hang up and call 911 now. I'm alerting our medical team.
   ```

6. Disable initialization/validation and fulfillment code hooks on **every
   intent**, including fallback. No function is attached to any alias.
   Configure fallback to close and return to the flow.
7. **Build**. In the Lex **Test** pane, reset the conversation for each of
   `yes`, `no`, `I'm okay`, `not really`, `I'm fine`, and `kind of`. Inspect
   the intent and slots after the first reply. Check whether A1 has a value
   and whether the next prompt is A2. With documented FreeFormInput behavior,
   expect A1 to be empty and the repeated safety prompt. Answer that prompt,
   then A2–A5; verify all five slots and the closing response.
8. Reset and test each emergency utterance as the first reply. Also test
   `I can't breathe` while eliciting A5: it is collected as A5, not an intent
   switch. The backend escalates it to **HELP_NOW / R0 after disconnect**;
   this configuration cannot promise the emergency message mid-dialog.
9. **Bot versions → Create version**. **Aliases → Create alias** named
   **live**, pointing at that version. Rebuild, version and repoint `live`
   after later changes. Calls always use **live**, never **TestBotAlias** (limited to two concurrent calls).

Console acceptance record (pending a human console session):

| Test | Result |
| --- | --- |
| First reply selects CheckIn; repeat safety prompt for A1 | Selected design; console verification pending |
| Repeat safety prompt fills A1, then A2–A5 | Not console verified |
| All five slot values and closing response | Not console verified |
| Emergency entry returns Emergency | Not console verified |
| Emergency phrase in A5 becomes HELP_NOW after disconnect | Backend unit test passes; phone test pending |

## 3. Contact flow: slots to persisted contact attributes

1. AWS Connect console → instance → **Flows → Amazon Lex** → add
   **CareCallCheckIn**, region us-east-1, alias **live**.
2. Connect admin website → **Routing → Flows → Create flow**.
   Name **CareCall outbound check-in**. Use these blocks:

   | Order | Block | Settings / next step |
   | --- | --- | --- |
   | 1 | Set logging behavior | Enable flow logging → 2 |
   | 2 | Set voice | Joanna, Neural, English (US); enable language attribute en_US → 3 |
   | 3 | Set contact attributes | User defined: `answered=yes` → 4 |
   | 4 | Get customer input | TTS below; Lex CareCallCheckIn, alias live; session attribute `residentId` dynamically from User defined / residentId → 5 |
   | 5 | Set contact attributes | Persist intent and populated slots as below → 6 |
   | 6 | Check contact attributes | User defined / intent: Emergency → 7; CheckIn → 8; FallbackIntent, default or error → 9 |
   | 7 | Play prompt | `Please hang up and call 911 now. I'm alerting our medical team.` → 8 |
   | 8 | Disconnect / hang up | End contact; CheckIn already spoke its closing response |
   | 9 | Set contact attributes | User defined: `outcome=no_input` → 8 |

   **Get customer input TTS**, exactly `script.QUESTIONS[1]`:

   ```text
   Hi, this is CareCall from County Public Health, checking on you during the power outage. Are you safe right now?
   ```

   Add intent exits **CheckIn**, **Emergency**, and **FallbackIntent** to the
   input block. Route successful exits through the attribute-copy stage and
   branch; route input **Error/default** to `outcome=no_input` and disconnect.

3. In the attribute-copy stage, use **Set dynamically**, namespace **Lex**.
   These are the source paths and user-defined destination keys:

   | Source | Destination |
   | --- | --- |
   | `$.Lex.IntentName` | `intent` |
   | `$.Lex.Slots.A1` | `a1` |
   | `$.Lex.Slots.A2` | `a2` |
   | `$.Lex.Slots.A3` | `a3` |
   | `$.Lex.Slots.A4` | `a4` |
   | `$.Lex.Slots.A5` | `a5` |

   Save intent before slots. Use separate Set contact attributes blocks for
   optional slot copies, continuing on a missing slot's Error exit, so a
   missing A1 on Emergency does not discard the intent or other answers.
   These paths are documented in
   [Set contact attributes](https://docs.aws.amazon.com/connect/latest/adminguide/set-contact-attributes.html).
   `residentId` is set by the backend when dialing and remains a session
   attribute for continuity; the backend identifies results by contact ID.
4. Add no invocation blocks. Add no recording blocks; recording stays off.
   Route setup-block errors to the no-input/disconnect path. **Save → Publish**,
   then copy the flow ID from **Show additional flow information**.

**Partial-call limitation:** slots are copied when Get customer input returns.
If the caller hangs up inside Lex before the copy stage runs, earlier slots may
not be persisted to contact attributes. The collector saves every answer that
is present, but cannot recover slots never copied. Include a mid-call hang-up
in phone acceptance; do not claim per-turn persistence or live question progress.
The Emergency closing response and the flow's Emergency prompt both use the
required text, so an Emergency entry can hear it twice.

## 4. EC2 backend and CloudFront (Himanshu)

Himanshu creates the tables, process environment and hosting:

- **Residents**: string partition key `id`.
- **Checkins**: string partition key `resident_id`, string sort key `at`.
- `/etc/careline/backend.env`: keys from `backend/.env.example`. Set
  `RESIDENTS_TABLE`, `CHECKINS_TABLE`, Connect IDs and caller ID, and
  `ALLOWED_ORIGINS=https://<cloudfront>,http://localhost:5173`.
  Omit the local `AWS_PROFILE` setting when the server's AWS access uses
  another mechanism. The process needs Connect StartOutboundVoiceContact,
  DescribeContact and GetContactAttributes, table access and the existing
  Parameter Store phone lookup access. This guide creates no IAM roles.
- CloudFront sends `/api/...` to EC2 port **8000** after stripping `/api`.
  For example `/api/queue` reaches `/queue`. Forward query strings, allow
  API write methods, and disable caching on the API behavior.

From `backend/`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --env-file /etc/careline/backend.env
```

If the service manager loads the environment file (for example via systemd
`EnvironmentFile=/etc/careline/backend.env`), the command is simply:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Run **one worker** so the background checker and line limit share a process.
Check `/health` locally and `https://<cloudfront>/api/health` through CloudFront.
Every five seconds the lifespan task checks disconnected contacts, saves results
and refills lines, even with the dashboard closed. Polls still check too.
`DescribeContact.DisconnectTimestamp` is authoritative; `NO_ANSWER_SECONDS=300`
from `call_started_at` is the backstop. No per-turn updates arrive at the server.

## 5. Demo residents and dashboard

1. Each consenting teammate enters their own number in Parameter Store:
   `/carecall/phones/<persona>`; personas `daniel-kim`, `ruth-okafor`,
   `maria-lopez`, `linh-tran`; Standard, SecureString, default key.
   Never paste real numbers into chat or commit them.
2. Load the backend environment, then from `backend/` run
   `python -m app.seed --demo` (add `--with-location` when `LOCATION_ENABLED=1`).
   It writes the teammate roster to the configured tables and prints masked numbers.
   Plain `python -m app.seed` loads the CSV instead, where nobody is callable
   (README "Seed residents").
   Restart after phone parameters change.
3. `web/.env.local`: `VITE_API_URL=https://<cloudfront>/api` (or
   `http://localhost:8000` locally). Run `npm run build` for hosting or
   `npm run dev` locally. Vite reads this setting at build time; rebuild when
   changing it. The default is localhost:8000.

## 6. Acceptance: one phone, then four

1. Call your own persona: `POST /residents/r-001/call`. Complete the console
   acceptance checks above first. Complete the five-slot dialogue, then verify
   `GET /queue` contains five answers and **PERSON_CHECK** with
   `All 5 answers in. Waiting for ranking`.
2. Test Emergency at entry, an emergency phrase in A5, a partial call and no
   answer. An emergency becomes **HELP_NOW**, rule **R0**; a partial transcript
   becomes **PERSON_CHECK**; two missed calls become **HELP_SOON**, rule **NA**.
3. Reset with `POST /demo/reset?zone=A`. Warn the team, then click **Start
   outage**: four allow-listed phones ring together. Results appear after
   disconnect. Close the dashboard during calls and verify results later to
   exercise the background checker.
4. For an offline rehearsal set `CONNECT_DRY_RUN=1`, empty both table names and
   `PHONES_SSM_PATH`, and mark synthetic demo residents `allow_call=true` via
   PATCH. Start outage; after about five to ten seconds `/queue` contains a
   five-answer transcript per completed fake call, with no real phones rung.

## Troubleshooting and cleanup

| Symptom | Check |
| --- | --- |
| Missing Connect settings / 503 | Server environment and published flow ID |
| 403 not allow-listed | Persona's Parameter Store entry and consent; restart server |
| Calls 3–4 fail | Published live alias and Connect concurrency quota |
| First reply repeats safety question | FreeFormInput constraint described in section 2 |
| Results have no answers | Inspect attribute-copy paths and whether hang-up bypassed them |
| Row remains CALLING after disconnect | Server logs, GetContactAttributes permission and background task |
| Dashboard cannot reach API | VITE_API_URL, CloudFront prefix rewrite, CORS origins and API cache behavior |

After judging, release the phone number before deleting the Connect instance,
delete the bot, and have Himanshu stop EC2/CloudFront and remove the demo tables
when their data is no longer needed.
