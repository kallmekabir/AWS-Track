// Dashboard settings from web/.env.local (git-ignored; see CLAUDE.md section 10).
// The backend address, VITE_API_URL, is read in api.ts.
const env = import.meta.env

export const config = {
  // VITE_USE_MOCKS=true, or ?mock in the address, answers from src/mock/ instead of the backend.
  useMocks: env.VITE_USE_MOCKS === 'true' || new URLSearchParams(window.location.search).has('mock'),
  awsRegion: env.VITE_AWS_REGION ?? 'us-east-1',
  mapStyle: env.VITE_MAP_STYLE ?? 'Monochrome',
  locationApiKey: env.VITE_LOCATION_API_KEY ?? '',
  pollMs: 3000,
}

/** The demo zone (backend/app/seed.py). */
export const ZONE = 'A'

/** San Jose is the only place CareCall runs, so every clock reads Pacific time. */
export const TIME_ZONE = 'America/Los_Angeles'
