// In-browser stand-in for the CareCall backend, used when config.useMocks is on
// (VITE_USE_MOCKS=true, or ?mock in the address). It answers the same calls api.ts
// makes, in the same shapes, so the dashboard can't tell the difference.
//
// Calls follow app/calling.py: 4 lines at a time in round 1 order; when a call ends the
// next person is dialed; a missed call goes to the back of the line; 2 misses = rule NA.
// Time runs fast so a rehearsal fits in about a minute.
//
//   ?mock        mock mode, nobody called yet
//   ?mock=30     mock mode, Start outage was pressed 30 seconds ago
import type { Answer, OutageResult, Resident, Status } from '../api'
import { clock } from '../lib/time'
import { QUESTIONS, ROSTER, type MockPerson } from './roster'

const MAX_LINES = 4
const RING_S = 3
const QUESTION_S = 3
const NO_ANSWER_S = 12
const MAX_MISSED_CALLS = 2

// Mirrors QUEUE_ORDER in backend/app/models.py.
const QUEUE_ORDER: Record<Status, number> = {
  HELP_NOW: 0,
  HELP_SOON: 1,
  PERSON_CHECK: 2,
  NEEDS_SUPPLIES: 3,
  OK_FOR_NOW: 4,
  CALLING: 5,
  NOT_CALLED: 6,
}

interface PlannedCall {
  id: string
  start: number // seconds after Start outage
  end: number
  answered: boolean
}

let startedAt: number | null = null
let calls: PlannedCall[] = []

const callLength = (p: MockPerson) => (p.answers ? RING_S + 5 * QUESTION_S + p.extra : NO_ANSWER_S)
const iso = (seconds: number) => new Date(startedAt! + seconds * 1000).toISOString()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Round 1 (docs/RANKING.md): device group, then fewest backups on file, then id. */
function round1(people: MockPerson[]): MockPerson[] {
  return [...people].sort(
    (a, b) => a.device_group - b.device_group || a.backups_on_file - b.backups_on_file || a.id.localeCompare(b.id),
  )
}

/** Plays the whole wave ahead of time: 4 lines, refilled as each call ends. */
function planWave(): PlannedCall[] {
  const waiting = round1(ROSTER).map((p) => p.id)
  const missed: Record<string, number> = {}
  const lineFree = Array.from({ length: MAX_LINES }, (_, i) => i * 0.3) // the 4 calls start back to back
  const planned: PlannedCall[] = []
  while (waiting.length) {
    lineFree.sort((a, b) => a - b)
    const start = lineFree.shift()!
    const id = waiting.shift()!
    const p = ROSTER.find((x) => x.id === id)!
    const end = start + callLength(p)
    planned.push({ id: p.id, start, end, answered: p.answers !== null })
    if (!p.answers) {
      missed[p.id] = (missed[p.id] ?? 0) + 1
      if (missed[p.id] < MAX_MISSED_CALLS) waiting.push(p.id) // back of the line
    }
    lineFree.push(end)
  }
  return planned
}

/** recheck_at = runs_out_at − 1 h, kept between 30 min and 3 h from the end of the call. */
function recheckAt(endSeconds: number, hours: number): string {
  const end = startedAt! + endSeconds * 1000
  const runsOut = end + hours * 3600_000
  const at = Math.min(Math.max(runsOut - 3600_000, end + 30 * 60_000), end + 3 * 3600_000)
  return clock(at)
}

function residentAt(p: MockPerson, t: number): Resident {
  const base: Resident = {
    id: p.id,
    name: p.name,
    phone: p.phone,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    zone: 'A',
    device: p.device,
    device_group: p.device_group,
    backups_on_file: p.backups_on_file,
    backup_hours_each: p.backup_hours_each,
    allow_call: true,
    status: 'NOT_CALLED',
    rule_id: null,
    reason: null,
    hours_left: null,
    runs_out_at: null,
    drive_minutes: p.drive_minutes,
    emergency: false,
    transcript: [],
    contact_id: null,
    call_started_at: null,
    last_activity_at: null,
    current_question: 0,
    missed_calls: 0,
    last_error: null,
    updated_at: null,
  }
  if (startedAt === null) return base

  const mine = calls.filter((c) => c.id === p.id && c.start <= t)
  const last = mine.at(-1)
  if (!last) return base

  const missedSoFar = mine.filter((c) => !c.answered && c.end <= t).length
  const answersUpTo = (n: number): Answer[] =>
    (p.answers ?? []).slice(0, n).map((answer, i) => ({ q: i + 1, question: QUESTIONS[i], answer }))
  const call = {
    contact_id: `mock-${p.id}-${mine.length}`,
    call_started_at: iso(last.start),
    missed_calls: missedSoFar,
    updated_at: iso(Math.min(t, last.end)),
  }

  if (t < last.end) {
    // On the call: ringing, then one answer every few seconds (simulated progress for mock rehearsals).
    const answered = last.answered ? Math.min(5, Math.max(0, Math.floor((t - last.start - RING_S) / QUESTION_S))) : 0
    const asking = last.answered && t - last.start >= RING_S ? Math.min(5, answered + 1) : 0
    return {
      ...base,
      ...call,
      status: 'CALLING',
      reason: asking ? `On the call: question ${asking} of 5` : 'Ringing',
      current_question: asking,
      transcript: answersUpTo(answered),
      last_activity_at: answered ? iso(last.start + RING_S + answered * QUESTION_S) : null,
    }
  }

  if (last.answered && p.result) {
    const { status, rule_id, hours_left } = p.result
    const reason = status === 'OK_FOR_NOW' ? `${p.result.reason} ${recheckAt(last.end, hours_left ?? 0)}` : p.result.reason
    return {
      ...base,
      ...call,
      status,
      rule_id,
      reason,
      hours_left,
      runs_out_at: hours_left === null ? null : iso(last.end + hours_left * 3600),
      transcript: answersUpTo(5),
      last_activity_at: iso(last.end),
    }
  }

  // Missed: app/calling.py, _close_unfinished_call.
  return missedSoFar >= MAX_MISSED_CALLS
    ? { ...base, ...call, status: 'HELP_SOON', rule_id: 'NA', reason: `No answer (${missedSoFar} tries). Send a welfare check` }
    : { ...base, ...call, status: 'NOT_CALLED', reason: `No answer (${missedSoFar} try). Calling again` }
}

function everyone(): Resident[] {
  const t = startedAt === null ? 0 : (Date.now() - startedAt) / 1000
  return ROSTER.map((p) => residentAt(p, t))
}

/** Mirrors store.queue(): level, then hours left (unknown counts as 0), device group, id. */
function ranked(list: Resident[]): Resident[] {
  return [...list].sort(
    (a, b) =>
      QUEUE_ORDER[a.status] - QUEUE_ORDER[b.status] ||
      (a.hours_left ?? 0) - (b.hours_left ?? 0) ||
      a.device_group - b.device_group ||
      a.id.localeCompare(b.id),
  )
}

function start(secondsAgo = 0) {
  startedAt = Date.now() - secondsAgo * 1000
  calls = planWave()
}

const preset = new URLSearchParams(window.location.search).get('mock')
if (preset && Number(preset) > 0) start(Number(preset))

// ---- the same functions api.ts exports ----

export async function getQueue(_zone = 'A'): Promise<Resident[]> {
  await sleep(80)
  return ranked(everyone())
}

export async function getResidents(_zone = 'A'): Promise<Resident[]> {
  await sleep(80)
  return everyone()
}

export async function getResident(id: string): Promise<Resident> {
  await sleep(80)
  const r = everyone().find((x) => x.id === id)
  if (!r) throw new Error('Resident not found')
  return r
}

export async function startOutage(zone = 'A'): Promise<OutageResult> {
  await sleep(300)
  if (everyone().some((r) => r.status === 'CALLING')) {
    throw new Error(`Calls are still going in zone ${zone}. Wait, or reset the demo.`)
  }
  start()
  const first = calls.slice(0, MAX_LINES).map((c) => c.id)
  const rest = round1(ROSTER).map((p) => p.id).filter((id) => !first.includes(id))
  return { zone, calling: first, errors: [], waiting: rest, not_on_allow_list: [] }
}

export async function callAgain(id: string): Promise<Resident> {
  await sleep(250)
  const now = everyone().find((x) => x.id === id)
  if (!now) throw new Error('Resident not found')
  if (now.status === 'CALLING') throw new Error(`${now.name} is already on a call.`)
  if (startedAt === null) start()
  const t = (Date.now() - startedAt!) / 1000
  const p = ROSTER.find((x) => x.id === id)!
  calls.push({ id, start: t, end: t + callLength(p), answered: p.answers !== null })
  return residentAt(p, t)
}

export async function resetDemo(_zone = 'A'): Promise<{ reset: number }> {
  await sleep(150)
  startedAt = null
  calls = []
  return { reset: ROSTER.length }
}
