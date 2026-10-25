# CareLine

**When the power goes out, CareLine phones the people who can't wait.**

During a power outage, people who rely on powered medical equipment (oxygen, ventilators,
dialysis) can run out of time fast. CareLine is a working prototype on AWS: it places real
phone calls to residents, asks five short questions, and shows a duty officer one ranked
list of **who needs help first**.

Built for the AI-Driven Automation & Critical Service Continuity track at the Sparthill
hackathon, October 2026.

## How it works

1. A duty officer clicks **Start outage** on the dashboard.
2. CareLine phones up to 4 residents at the same time.
3. Each resident answers 5 questions on their keypad: are you safe, is your device
   working, how many backups, how many hours left, and what do you need.
4. Amazon Bedrock turns the answers into facts. Plain written rules (not the AI) decide
   each person's level: **Help now**, **Help soon**, **A person must check**,
   **Needs supplies**, or **OK for now**.
5. Amazon Location adds the drive time from the nearest hospital, so the people with the
   least time to spare go to the top of the list.
6. The dashboard shows the ranked list, a map, and for each person what they said, what
   Bedrock pulled out, and the rule that ranked them.

## AWS services

| Service | What it does in CareLine |
| --- | --- |
| **Amazon Connect** | Places the outbound calls (4 at once) and runs the keypad call script |
| **Amazon Bedrock** (Nova Lite) | Reads each resident's answers and returns structured facts (safe, device working, backups, hours left, needs) |
| **Amazon Location Service** | Finds each resident's drive time from the nearest hospital and draws the dashboard map |
| **Amazon DynamoDB** | Stores residents and every call result |
| **AWS Systems Manager Parameter Store** | Holds teammates' phone numbers encrypted; only these numbers can ever be called |
| **Amazon EC2** | Runs the backend (FastAPI) that dials, checks calls, and ranks results |
| **Amazon CloudFront + S3** | Hosts the dashboard and forwards `/api` requests to the backend |

```
Dashboard ──► CloudFront ──► EC2 backend ──► Amazon Connect ──► resident's phone
                                  │                │
                                  │                └─ keypad answers
                                  ├─► Amazon Bedrock   (answers → facts)
                                  ├─► rules R0–R6      (facts → level)
                                  ├─► Amazon Location  (hospital drive time)
                                  └─► DynamoDB         (save, then dial the next person)
```

The rules are in [`docs/RANKING.md`](docs/RANKING.md). Bedrock never picks a level; if its
answer is unclear, the person goes to **A person must check** so a human decides.

## Run it

You need **Git**, **Node.js 22+**, **Python 3.11+**, and the **AWS CLI**, plus access to an
AWS account (us-east-1) with the Amazon Connect instance and call script from
[`connect/SETUP.md`](connect/SETUP.md).

### 1. Clone

```bash
git clone https://github.com/kallmekabir/AWS-Track.git
cd AWS-Track
```

### 2. Sign in to AWS and set up the backend

```bash
aws login --region us-east-1 --profile carecall
cd backend
./setup.sh
```

`setup.sh` installs the Python packages and writes `backend/.env` and `web/.env.local`
with the Connect, Bedrock, and Location settings from your AWS account. Sign-ins expire;
if you see `ExpiredToken`, run `aws login` again and restart the backend.

### 3. Add your phone number

In the AWS console (N. Virginia), open **Parameter Store** and create a **SecureString**
named `/carecall/phones/<persona>` with your number as `+1XXXXXXXXXX`. Personas:
`daniel-kim`, `ruth-okafor`, `maria-lopez`, `linh-tran`. Never paste numbers into chat or
files.

### 4. Start the backend and the dashboard

```bash
# Terminal 1 (from backend/)
source .venv/bin/activate
uvicorn app.main:app --reload --env-file .env

# Terminal 2 (from web/)
npm install
npm run dev
```

Open **http://localhost:5173**. The map only loads on port 5173.

### 5. Make a call

Call only your own persona (`r-001` Daniel, `r-002` Ruth, `r-003` Maria, `r-004` Linh):

```bash
curl -X POST localhost:8000/residents/r-001/call
```

Answer on the keypad, waiting for each question to finish:

- **Q1** Are you safe? 1 yes, 2 no
- **Q2** Is your device working? 1 yes, 2 no, 3 not sure
- **Q3** How many full backups? 0–5
- **Q4** Hours until you run out? 0–9
- **Q5** What do you need? 1 nothing, 2 ride, 3 oxygen, 4 charging, 5 food, 6 medicine

A few seconds after you hang up, your row on the dashboard shows the level and the reason.
**Start outage** rings every teammate who has a number saved, so warn the team first.

### Without an AWS account

- **Dashboard preview:** run step 4's dashboard commands and open
  `http://localhost:5173/?mock` to explore the screen with sample residents.
- **Tests:** `cd backend && python -m unittest discover -s tests -t .`

## Project layout

```
backend/   FastAPI app: calling (Connect), Bedrock extraction, rules, ranking, Location
web/       React + Vite dashboard: ranked list, map, resident details
connect/   Amazon Connect call script builders and setup guide
eval/      24 test cases for the Bedrock extraction and rules
data/      Hospital locations and resident data
docs/      Ranking rules (RANKING.md) and project notes
```
