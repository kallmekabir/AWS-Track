# CareLine operator dashboard

React + Vite dashboard for Jane, the duty officer (task graph W01-W10, F07). It polls
the CareLine API every 3 s; the priority list and the map read the same
`/outages/{id}/priority` poll.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 (the map key only allows this origin)
```

Settings live in `web/.env.local` (gitignored, see task graph C2):

| Variable | Default | Notes |
| --- | --- | --- |
| `VITE_API_BASE` | unset | API Gateway stage URL. While unset, the dashboard uses mocks |
| `VITE_USE_MOCKS` | `true` when no API base | Force mocks on with `true` |
| `VITE_API_KEY`, `VITE_OPERATOR_ID` | `''`, `jane` | Sent as `x-api-key` and `x-operator-id` |
| `VITE_AWS_REGION`, `VITE_MAP_STYLE`, `VITE_LOCATION_API_KEY` | `us-east-1`, `Monochrome` | Without a map key the map panel hides and the list goes full width |

## Mock mode

`src/api/mock/` is an in-browser stand-in for the API: a scripted Zone 2 (East San
Jose) outage with 10 synthetic residents, run on the demo clock at 60x. Press
**Start outage** (Zone 2) and the wave plays out in about a minute; the battery-runway
recheck for R-137 fires about 3.5 minutes in.

URL presets for rehearsals and screenshots:

- `?mock=running` starts 47 demo minutes into the outage, with every triage group on screen
- `?mock=215` starts 215 minutes in, just after R-137's battery-runway recheck
- `?select=R-131` opens a resident (route, drawer) on load

## Layout

| Folder | Task | What it holds |
| --- | --- | --- |
| `src/api/` | F07 | Contract types (C8, C9), typed client, `usePoll`, mocks |
| `src/layout/` | W01 | The dashboard grid and polling |
| `src/header/` | W02 | Outage, demo clock, counters, start and end, zone strip |
| `src/priority/` | W03 | Priority list and battery-runway gauges |
| `src/map/` | W04, W05, W10 | Amazon Location map, canvas-drawn pins, route on selection |
| `src/drawer/` | W06 | Resident drawer: transcript beside Bedrock JSON, override |
| `src/tasks/`, `src/feed/` | W07 | Task queue, call log |
| `src/copilot/` | W08 | Brief, dispatch plan, approve, Ask CareLine |
| `src/fairness/` | W09 | Reach by language, what we store |

Design rules: only a resident's state is colored (triage colors in `src/map/colors.ts`);
words written by Bedrock are set in Source Serif, everything computed by code in Barlow;
the frontend never re-sorts the priority list.
