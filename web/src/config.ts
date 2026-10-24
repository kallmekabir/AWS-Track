// Build-time settings from web/.env.local (never committed). See task graph C2.
const env = import.meta.env

export const config = {
  apiBase: (env.VITE_API_BASE ?? '').replace(/\/$/, ''),
  apiKey: env.VITE_API_KEY ?? '',
  operatorId: env.VITE_OPERATOR_ID ?? 'jane',
  // Mocks stay on until a real API base is configured.
  useMocks: env.VITE_USE_MOCKS === 'true' || !env.VITE_API_BASE,
  awsRegion: env.VITE_AWS_REGION ?? 'us-east-1',
  mapStyle: env.VITE_MAP_STYLE ?? 'Monochrome',
  locationApiKey: env.VITE_LOCATION_API_KEY ?? '',
  pollMs: 3000,
}

/** The county's four outage zones (map spec section 2). */
export const ZONES = [
  { zone_id: 'Z1', zone_name: 'Downtown' },
  { zone_id: 'Z2', zone_name: 'East San Jose' },
  { zone_id: 'Z3', zone_name: 'Berryessa' },
  { zone_id: 'Z4', zone_name: 'South San Jose' },
] as const

/** San Jose is the only place CareLine runs, so every clock reads Pacific time. */
export const TIME_ZONE = 'America/Los_Angeles'
