# Tech stack

- Python 3.12, AWS Lambda, boto3, AWS CDK (Python)
- Region: us-east-1 only
- DynamoDB tables: `Residents`, `Calls`, `Tasks`, `Audit` (on-demand billing)
- Step Functions Standard workflows: `CallWave` (Map, MaxConcurrency 3) and `ResidentCheck`
  (task token on the call, waits for retries and battery-runway rechecks)
- EventBridge events: `careline.outage.started`, `careline.outage.ended`,
  `careline.checkin.completed`
- Amazon Connect + Lex V2 (`CareLineCheckIn`, locales en_US, es_US, hi_IN)
- Amazon Bedrock Converse API:
  - extraction: a fast Claude Haiku model, temperature 0, output must validate against
    `schemas/checkin.json`
  - operator copilot: a Claude Sonnet model with tool use, read-only tools, max 6 tool calls
  - resident answers: Bedrock Knowledge Bases `RetrieveAndGenerate` + a Bedrock guardrail
- `TIME_SCALE` env var compresses time for demos (60 = one hour becomes one minute)
- Frontend: React + Vite, polling the API every 3 s (no websockets)
- Tests: pytest + moto, next to the code as `test_*.py`
