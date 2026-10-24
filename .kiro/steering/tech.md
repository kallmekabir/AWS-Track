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
- Amazon Location Service (enhanced APIs, no map/route resources to create):
  - Maps: MapLibre GL JS (`maplibre-gl`) with the `Monochrome` style, Light color scheme,
    through API key `careline-map-key` (`geo-maps:GetTile` only, referrer-locked, expires
    2026-10-31). The key lives in `web/.env.local` as `VITE_LOCATION_API_KEY`, never in git
  - Routes: only Lambda `geo` calls `boto3.client("geo-routes")` with IAM on
    `arn:aws:geo-routes:us-east-1::provider/default`. `CalculateRouteMatrix` at outage
    start (3 straight-line candidates per resident, `RoutingBoundary.Geometry` bounding
    box, never `Unbounded`), `CalculateRoutes` on click (`LegGeometryFormat=Simple`).
    Both use `DepartNow` with live traffic and fall back to labeled straight-line distance
  - No Places API: hospitals come from `data/hospitals.csv`
- Shared Lambda layer `lambdas/shared/careline_shared/`: `priority_key()` (one sort for
  the priority list and the copilot), `hospitals.json`, haversine helpers
- `TIME_SCALE` env var compresses time for demos (60 = one hour becomes one minute).
  Drive times are always shown in real-world minutes
- Frontend: React + Vite, polling the API every 3 s (no websockets). The priority list
  and the map read the same `/outages/{id}/priority` poll; polls never move the camera
- Tests: pytest + moto, next to the code as `test_*.py`
