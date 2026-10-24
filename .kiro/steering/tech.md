# Workshop tech stack

- Python FastAPI + Pydantic + boto3 in `backend/app/`, region us-east-1.
- One long-lived EC2 uvicorn process on port 8000. Install
  `backend/requirements.txt`; no Mangum handler or Lambda packaging.
- CloudFront serves the dashboard and proxies `/api/...`, stripping `/api` before
  FastAPI. `/etc/careline/backend.env` uses the keys in `backend/.env.example`.
  `ALLOWED_ORIGINS` accepts the CloudFront URL and localhost as a comma-separated list.
- DynamoDB: Residents PK `id`; Checkins PK `resident_id`, SK `at`. Names come from
  RESIDENTS_TABLE and CHECKINS_TABLE. Unconfigured local runs use memory.
- **Why no Lambda:** IAM role creation is blocked; WSParticipantRole cannot be
  assumed by AWS services. No execution functions, Step Functions, API Gateway,
  code hooks, SAM deployment or CDK bootstrap in the workshop path.
- Amazon Connect + Lex V2 **CareCallCheckIn**, en_US, published **live** alias.
  CheckIn uses five required FreeFormInput slots A1–A5. The first reply selects
  the intent; repeat the safety question to fill A1, then ask QUESTIONS[2..5].
  Emergency intent has the fixed response from `app/script.py`.
- Connect persists answered, intent and populated a1–a5 contact attributes.
  `app/call_results.py` reads them after disconnect. A five-second FastAPI
  lifespan task checks even without a dashboard; polls check too, under one lock.
  DescribeContact's disconnect timestamp is primary; 300 seconds from call start
  is the backstop. Store transitions guard the contact ID against duplicate saves.
- FreeFormInput cannot switch intents while collecting a slot. Emergency phrases
  in slot answers escalate after disconnect; early hang-up may bypass slot copying.
  No per-turn backend progress. Console/phone acceptance is still pending.
- CONNECT_DRY_RUN=1 completes fake five-answer contacts without phones; consent
  remains required. Other residents remain uncalled; there is no simulator function.
- Phase 2 Bedrock goes in `call_results.extract_facts(transcript)`, currently None,
  wiring the existing `app/understand.py` and `app/rules.py` helpers. Use BEDROCK_MODEL_ID (Amazon Nova plan),
  Converse with forced record_checkin tool, and RANKING.md's facts shape. Plain
  Python `app/rules.py` decides levels; `app/ranking.py` sets round 1 order. The
  helpers are tested offline, but the collector hook still returns None; model
  access alone is not integration.
- Amazon Location: MapLibre browser map today. Planned `app/location.py` computes
  supplier-to-resident drive time for time to spare. No geo function or shared
  layer. See `.plans/amazon-location-map-spec.md`; hospital routing is deferred.
- Frontend React + Vite polls `/queue?zone=A` every three seconds. VITE_API_URL
  defaults to http://localhost:8000; hosted value https://<cloudfront>/api is
  read at build time. Polls do not move the map camera.
- Tests: unittest with fakes in `backend/tests/`; web build and lint with npm.
- Active implementation status: `docs/NEXT_STEPS.md`. Files under
  `docs/reference/` preserve historical designs, not workshop instructions.
