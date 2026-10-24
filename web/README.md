# CareCall dashboard

The one screen Jane uses during an outage (CLAUDE.md section 3): the ranked list of who
to help first, a map of Zone A, and one person's details. It asks the backend for
`GET /queue` every 3 seconds; the list, the pins and the details all read that one answer.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 (the map key only allows this address)
```

Start the backend first (see the main `README.md`, "Run the backend"). Settings live in
`web/.env.local`, which git ignores:

| Variable | Default | What it does |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:8000` | The backend address |
| `VITE_LOCATION_API_KEY` | none | Amazon Location map key. Without it the map hides and the list goes full width |
| `VITE_USE_MOCKS` | off | `true` answers from `src/mock/` instead of the backend |

## Mock mode: rehearse without the backend

Add `?mock` to the address (or set `VITE_USE_MOCKS=true`). The mock plays the 8 made-up
Zone A residents from `backend/app/seed.py`: Start outage calls 4 at a time, each call
steps through the 5 questions, and the results follow the worked example in
`docs/RANKING.md` (Daniel and Ruth "Help now", then Maria). It runs fast: the whole wave
takes about a minute. The mock also plays Phase 2 (levels, drive times), which the real
backend doesn't do yet.

- `?mock=9` starts 9 seconds into the wave (calls in progress)
- `?mock=70` starts after every call has finished
- `?select=r-002` opens that person's details

## Where things are

| Folder | What it holds |
| --- | --- |
| `src/api.ts` | Every call to the backend (and the switch to the mock) |
| `src/mock/` | The mock backend for rehearsals |
| `src/layout/` | The one screen and its 3-second poll |
| `src/header/` | Zone, time now, counts, Start outage |
| `src/priority/` | The ranked list and the backup gauges |
| `src/map/` | The Amazon Location map and its pins |
| `src/drawer/` | One person's details |
| `src/lib/levels.ts` | Plain words for every level and rule |

Rules the code keeps:

- The list shows people in the order `/queue` returns; the browser never re-sorts.
- Every level shows its words and its rule ID, never color alone.
- Red is for "Help now" only.
- Buttons are at least 44 px tall.
