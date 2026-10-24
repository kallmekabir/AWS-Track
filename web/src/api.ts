// All calls from the Vite dashboard to the CareCall backend live here.
// Set the address in web/.env.local:   VITE_API_URL=http://localhost:8000
// With VITE_USE_MOCKS=true (or ?mock in the address) the same functions answer from
// src/mock/ instead, so the dashboard runs without the backend.
import { config } from './config'
import * as mock from './mock'

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const MOCK = config.useMocks

export type Status =
  | 'HELP_NOW'
  | 'HELP_SOON'
  | 'PERSON_CHECK'
  | 'NEEDS_SUPPLIES'
  | 'OK_FOR_NOW'
  | 'CALLING'
  | 'NOT_CALLED'

export interface Answer {
  q: number
  question: string
  answer: string
}

// Mirrors ResidentOut in backend/app/models.py. The phone arrives masked.
export interface Resident {
  id: string
  name: string
  phone: string
  address: string
  lat: number
  lng: number
  zone: string
  device: string
  device_group: number
  backups_on_file: number | null
  backup_hours_each: number | null
  allow_call: boolean
  status: Status
  rule_id: string | null
  reason: string | null
  hours_left: number | null
  runs_out_at: string | null
  drive_minutes: number | null
  emergency: boolean
  transcript: Answer[]
  contact_id: string | null
  call_started_at: string | null
  last_activity_at: string | null
  current_question: number
  missed_calls: number
  last_error: string | null
  updated_at: string | null
}

export interface OutageResult {
  zone: string
  calling: string[]
  errors: { id: string; error: string }[]
  waiting: string[]
  not_on_allow_list: string[]
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    // FastAPI puts the reason in {"detail": "..."}; show that, not a status code.
    const text = await res.text()
    let detail = text
    try {
      detail = JSON.parse(text).detail ?? text
    } catch {
      // not JSON: keep the raw text
    }
    throw new Error(typeof detail === 'string' ? detail : `${options.method ?? 'GET'} ${path} failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

const zoneQuery = (zone: string) => `?zone=${encodeURIComponent(zone)}`

// GET requests: read data
export const getQueue = (zone = 'A') =>
  MOCK ? mock.getQueue(zone) : request<Resident[]>(`/queue${zoneQuery(zone)}`)
export const getResidents = (zone = 'A') =>
  MOCK ? mock.getResidents(zone) : request<Resident[]>(`/residents${zoneQuery(zone)}`)
export const getResident = (id: string) => (MOCK ? mock.getResident(id) : request<Resident>(`/residents/${id}`))

// POST / PATCH requests: change data
export const startOutage = (zone = 'A') =>
  MOCK ? mock.startOutage(zone) : request<OutageResult>('/outages', { method: 'POST', body: JSON.stringify({ zone }) })

export const callAgain = (id: string) =>
  MOCK ? mock.callAgain(id) : request<Resident>(`/residents/${id}/call`, { method: 'POST' })

export const resetDemo = (zone = 'A') =>
  MOCK ? mock.resetDemo(zone) : request<{ reset: number }>(`/demo/reset${zoneQuery(zone)}`, { method: 'POST' })

export const createResident = (resident: Partial<Resident>) =>
  request<Resident>('/residents', { method: 'POST', body: JSON.stringify(resident) })

export const updateResident = (id: string, changes: Partial<Resident>) =>
  request<Resident>(`/residents/${id}`, { method: 'PATCH', body: JSON.stringify(changes) })
