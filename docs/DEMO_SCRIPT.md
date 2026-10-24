# CareCall demo script (5 minutes)

Read the **Say** lines out loud. **Show** is what is on screen at that moment. Times are a guide: about 140 spoken words per minute.

---

## Before you press record

1. `backend/.env` has `BEDROCK_MODEL_ID` set, `LOCATION_ENABLED=1`, and `CONNECT_CONTACT_FLOW_ID` pointing at the **CareCall check-in keypad** flow (`connect/SETUP.md`, "Keypad check-in").
2. From `backend/`: `python -m app.seed --demo --with-location`, then `curl -X POST "localhost:8000/demo/reset?zone=A"`.
3. Check Ruth's drive time in `curl "localhost:8000/queue?zone=A"`. It must be **over 60 minutes** (she lives on Mt Hamilton Rd). If live traffic gives less, she lands in Help soon (R3) instead of Help now (R2). Re-run the refresh or change the 3:15 lines.
4. Dashboard open (`http://localhost:5173` or the CloudFront address). Map loaded, all 8 people show **Not called yet**.
5. Four teammates on speakerphone, each holding the keypad sheet below. Wait for each question to finish before pressing (Connect can drop early key presses).

### Keypad sheet

| Teammate plays | Safe? | Device working? | Backups | Hours | Needs | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Daniel Kim | 1 (yes) | 2 (no) | 0 | 0 | 3 (oxygen delivery) | Help now · R1 |
| Ruth Okafor | 1 (yes) | 1 (yes) | 1 | 2 | 3 (oxygen delivery) | Help now · R2 |
| Maria Lopez | 1 (yes) | 1 (yes) | 1 | 2 | 2 (a ride) | Help soon · R3 |
| Linh Tran | 1 (yes) | 1 (yes) | 3 | 9 | 4 (place to charge) | Needs supplies · R5 |

Ruth and Maria press **the same answers on purpose**. That is the point of the demo.

---

## 0:00 – 0:30 · The problem

**Show:** the dashboard. Map of San Jose, everyone "Not called yet".

**Say:**
> This is Jane, the duty officer at Santa Clara County Public Health. The power has just gone out across part of San Jose, where people rely on oxygen machines, ventilators and home dialysis. Their backup batteries are running down right now.
>
> Jane has a spreadsheet, a phone and three staff. By the time they've dialed everyone, someone's battery may be empty. CareCall makes those calls for her, four at a time, and tells her who to help first.

---

## 0:30 – 1:15 · How it's built

**Show:** the architecture slide (diagram at the end of this file).

**Say:**
> Everything runs on AWS. Jane's dashboard is delivered by Amazon CloudFront. Behind it, our Python server runs on EC2 and keeps residents in DynamoDB, a simple AWS database.
>
> To phone people, the server asks Amazon Connect, AWS's call center service. Connect reads out the questions and saves the answers.
>
> When a call ends, the answers go to Amazon Bedrock, using Amazon's Nova model, which turns words into clean facts. Then plain written rules, not the AI, decide who needs help first.
>
> Amazon Location Service puts everyone on the map and measures real driving time from the nearest hospital. The dashboard refreshes every three seconds.

---

## 1:15 – 1:45 · Round 1: who do we call first?

**Show:** point at the top four rows. Each row reads like "Oxygen concentrator · breathing device, called first · 1 backup on file". Then click **Start outage**.

**Say:**
> Before any phone rings, CareCall sets the calling order. Round one. Breathing devices first, then dialysis and infusion pumps, then everything else.
>
> Our first four all use breathing devices, so they're tied. The tiebreaker is backups on file, fewest first: Daniel has none, Ruth one, Maria two, Linh three. Jane clicks Start outage.

---

## 1:45 – 2:30 · Four phones at once

**Show:** four phones ringing on speaker. The four rows change to **Calling now**.

**Say:**
> There go four real phones, at the same moment, through Amazon Connect.
>
> Each person hears five short questions: Are you safe? Is your device working? How many backups? How many hours left? Do you need anything? Today they answer on the keypad. The call never gives medical advice, and it ends with: if you feel unsafe, call 911.
>
> When a call ends, the next person is dialed, so all four lines stay busy. Miss a call and you go to the back of the line. Miss two and you're flagged for an in-person visit. That's rule NA.
>
> CareCall only dials people who agreed to be called. Today that's our teammates. Everyone else here is made up.

---

## 2:30 – 3:15 · Bedrock turns answers into facts

**Show:** calls finish, the list reorders. Click **Ruth**. In the details panel, point at **what she said**, then **Bedrock's facts**.

**Say:**
> Calls are coming back and the list is reshuffling. Let's open Ruth. Here's what she told us: one tank left, about two hours, needs an oxygen delivery. And here's what Bedrock pulled out: one backup, two hours, needs oxygen, and how confident it is.
>
> Bedrock has one job: turn words into facts. It fills in a fixed form, so it can't ramble or invent fields, and if it isn't sure it must say "unsure". It never decides who is safe. If Bedrock fails, that person goes straight to a human: rule R4, "A person must check".

---

## 3:15 – 4:15 · Round 2: who do we help first? (and live location)

**Show:** the list order: Daniel, Ruth, Maria, Linh. Ruth is still selected, so the map shows her road route to the nearest hospital and the drive time. Point at Ruth's reason line: "R2 · Supplier 70 min away, 50 min to spare".

**Say:**
> Now round two: who do we help first? Rules R0 to R6 are checked top to bottom, and the first match wins. Danger rules come first.
>
> Daniel: device off, no backups. Rule R1, Help now.
>
> Now Ruth and Maria. They gave the exact same answers: one tank, two hours. But Ruth lives up on Mount Hamilton. Amazon Location turned her address into a map point, measured the drive from all six county hospitals, and kept the shortest: about seventy minutes. Two hours minus a seventy minute drive leaves fifty minutes to spare. Under an hour is rule R2: Help now. Maria is fifteen minutes away, with an hour forty-five to spare. Rule R3, Help soon.
>
> That's our big idea: we rank by **time to spare**, hours left minus the drive to reach them. It's also the tiebreaker inside a level. Daniel and Ruth are both Help now, but Daniel has no time at all, so he's on top.
>
> Click anyone, and the map draws the real road from their nearest hospital with current traffic. Linh has nine hours and just needs a place to charge: rule R5, Needs supplies.

**Note for the presenter:** drive times are worked out once, when a person is added or when we press refresh, and then saved. The dashboard's 3-second updates never pay for a new route. The road drawn on click is fetched live with traffic and kept for 15 minutes.

---

## 4:15 – 4:45 · Why Jane can trust it

**Show:** slowly scroll the list. Point at a level chip (color plus a word) and a reason line.

**Say:**
> Every place in line shows its reason in plain words, with the rule number. Every color comes with a word. Jane sees what each person said, what the AI heard, and which rule placed them. The AI reads. The rules decide. Jane acts. And the rules are plain Python, tested every time we change them.

---

## 4:45 – 5:00 · Close

**Show:** the full dashboard.

**Say:**
> Four phones in one click. Every answer turned into facts by Bedrock. A ranked list that counts the drive. That's CareCall: when the power goes out, we call the people who can't wait, and tell Jane who to reach first. Thank you.

---

## Architecture slide

```text
  Jane's browser
       │  (asks for new data every 3 s)
       ▼
  Amazon CloudFront ──── serves the dashboard, passes /api to the server
       │
       ▼
  EC2: Python server (FastAPI) ───── DynamoDB: residents and call results
       │          │          │
       │          │          └──► Amazon Location: address → map point,
       │          │                hospital → home drive times, road route
       │          │
       │          └──► Amazon Bedrock (Nova): answers → facts
       │                     │
       │                     ▼
       │               Ranking rules (plain Python) → level + rule ID
       │
       └──► Amazon Connect ──► 4 phones ring at once ──► keypad answers
```

One line under the diagram: **"Bedrock reads. Rules decide. Jane acts."**

---

## Quick answers if a judge asks

| Question | Short answer |
| --- | --- |
| Why not let the AI rank people? | An AI can be confidently wrong. Written rules give the same answer every time, show their reason, and can be tested. |
| Why four calls at a time? | Fast enough to reach everyone quickly, small enough to stay within the phone system's limits. It's one setting to raise. |
| Why drive time instead of distance on the map? | A hospital 5 miles away over a mountain road can take longer than one 10 miles away on a freeway. Help arrives by road. |
| Why save "runs out at" instead of just "hours left"? | "Two hours left" is only true at the moment they said it. A clock time lets the countdown keep ticking. |
| Why keypad and not voice? | The workshop account can't create the voice bot (it blocks a required permission). Bedrock still reads words, so the rest is unchanged. |
| What isn't built yet? | The "Help now" alert email (Amazon SNS) and spoken answers. |
