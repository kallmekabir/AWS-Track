# Repository structure

```
infra/                 CDK stacks: CareLineData, CareLineCore, CareLineApi, CareLineWeb
lambdas/<name>/        one folder per Lambda, entry point handler.py
  dialer/              StartOutboundVoiceContact, allow-list check
  lex_hook/            Lex code hook: redaction, Bedrock extraction, slot filling
  triage/              rules R0–R7 (rules.py) and task creation
  copilot/             Bedrock tool-use loop and read-only tools
  api/                 REST handlers for the dashboard (incl. /outages/{id}/priority)
  geo/                 Amazon Location Routes: hospital access at outage start, route on click
  shared/              Lambda layer careline_shared: priority.py, hospitals.json, geo_math.py
data/                  hospitals.csv, residents.sample.csv (committed); private/ (gitignored)
scripts/               seed.py, build_geo_data.py (CSV -> hospitals GeoJSON/JSON)
schemas/               JSON schemas shared by Lambdas and the eval
eval/                  scenarios.yaml, run.py, report.json
connect/               exported contact-flow JSON
kb/                    Knowledge Base source documents (verified resource sites, FAQ)
web/                   React + Vite operator dashboard (src/map/, src/priority/)
docs/                  implementation plan and diagrams
.plans/                feature specs, e.g. amazon-location-map-spec.md
```

Keep handlers thin; put logic in importable modules so the eval can call it directly.
