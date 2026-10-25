# CareLine

**When the power goes out, CareLine phones the people who can't wait.**

During a power outage, people who rely on powered medical equipment (oxygen, ventilators,
dialysis) can run out of time fast. CareLine calls them automatically, asks five short
questions, and shows a duty officer one ranked list: **who needs help first**.

Built for the AI-Driven Automation & Critical Service Continuity track at the Sparthill
hackathon, October 2026.

## How it works

1. A duty officer clicks **Start outage** on the dashboard.
2. CareLine calls up to 4 residents at once with **Amazon Connect**.
3. Each resident answers 5 questions on their keypad: are you safe, is your device
   working, how many backups, how many hours left, and what do you need.
4. **Amazon Bedrock** turns the answers into facts. Plain written rules (not the AI)
   decide each person's level: *Help now*, *Help soon*, *A person must check*,
   *Needs supplies*, or *OK for now*.
5. **Amazon Location** adds the drive time to the nearest hospital, so the people with the
   least time to spare go to the top of the list.

All resident data is made up, and only teammates who agreed to it get real calls.

## Run it on your computer

You need **Git**, **Node.js 22+**, and **Python 3.11+**.

### 1. Clone the repo

```bash
git clone https://github.com/kallmekabir/AWS-Track.git
cd AWS-Track
```

### 2. Try the dashboard (no AWS, no backend)

```bash
cd web
npm install
npm run dev
```

Open **http://localhost:5173/?mock** and click **Start outage**. The dashboard uses
built-in sample data, so nothing else is needed.

### 3. Run the backend too (still no AWS)

Open a second terminal in the `AWS-Track` folder:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
echo "CONNECT_DRY_RUN=1" > .env    # fake calls: no phone rings, no AWS needed
uvicorn app.main:app --reload --env-file .env
```

Now open **http://localhost:5173** (without `?mock`). The dashboard reads from the backend at
`http://localhost:8000`.

The sample residents start as "do not call". To watch a fake outage, allow them, then
click **Start outage**:

```bash
for i in 1 2 3 4 5 6 7 8; do
  curl -s -X PATCH localhost:8000/residents/r-00$i \
    -H 'content-type: application/json' -d '{"allow_call":true}' > /dev/null
done
```

Fake answers arrive after about 5 seconds. Without Bedrock, most people land in
**A person must check**. That's on purpose: when the facts are unclear, a human decides.

### 4. Run the tests

```bash
cd backend
python -m unittest discover -s tests -t .
```

### Real phone calls (AWS account needed)

Real calls need an AWS account with Amazon Connect, Bedrock, and Location set up. Follow
[`connect/SETUP.md`](connect/SETUP.md), then run `backend/setup.sh`, which fills in
`backend/.env` from your AWS sign-in.

## Built with

Amazon Connect · Amazon Bedrock (Nova Lite) · Amazon Location · Amazon DynamoDB ·
Amazon EC2 · Amazon CloudFront · FastAPI (Python) · React + Vite (TypeScript)

## Project layout

```
backend/   FastAPI app: calling, Bedrock extraction, triage rules, ranking
web/       React dashboard: ranked list, map, resident details
connect/   Amazon Connect call flows and setup guide
eval/      24 test cases for the extraction and rules
data/      Hospitals and sample residents
docs/      Ranking spec (docs/RANKING.md) and project notes
```
