// In-browser stand-in for the CareLine API, used while VITE_USE_MOCKS=true.
// The whole outage is a pure function of the demo clock (scripts in ./data), plus a
// small overlay of operator actions (overrides, task acks, briefs, approvals).
//
// URL presets for development and screenshots:
//   ?mock=running   start with the Zone 2 outage already 47 demo minutes in
//   ?mock=215       start N demo minutes in (215 shows the battery-runway recheck)
import { ApiError, type Api } from '../client'
import { config } from '../../config'
import { clock, span } from '../../lib/time'
import type {
  AuditAction,
  AuditEntry,
  Brief,
  BriefPriority,
  CallRow,
  CallStatus,
  FairnessMetric,
  HospitalRoute,
  Language,
  OutageMeta,
  PriorityRow,
  Task,
  TaskStatus,
  TaskType,
  Triage,
  TriageGroup,
} from '../types'
import { HOSPITALS, MOCK_ZONE, RESIDENTS, SCRIPTS, TIME_SCALE, type AttemptScript, type MockResident } from './data'
import { driveTieBreak, rankRows } from './priority'

interface AttemptState {
  script: AttemptScript
  attempt: number
  call_id: string
  status: CallStatus
  finished: boolean
  /** Answered and hung up, so the rules have decided. */
  decided: boolean
  triage: Triage | null
  rule_id: string | null
  endAt: number
}

interface Overlay {
  outage: OutageMeta | null
  startWall: number
  frozenAt: number | null
  overrides: Map<string, { triage: Triage }>
  taskStatus: Map<string, TaskStatus>
  planTasks: Task[]
  briefs: Map<string, Brief>
  approved: Set<string>
  audit: AuditEntry[]
}

const OPERATOR = config.operatorId
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
const jitter = (lo: number, hi: number) => lo + Math.random() * (hi - lo)

export function createMockApi(): Api {
  const s: Overlay = {
    outage: null,
    startWall: 0,
    frozenAt: null,
    overrides: new Map(),
    taskStatus: new Map(),
    planTasks: [],
    briefs: new Map(),
    approved: new Set(),
    audit: [],
  }

  // ---- clocks ----
  const simNow = () => (s.frozenAt ?? Math.max(0, ((Date.now() - s.startWall) / 60000) * TIME_SCALE))
  const simIso = (m: number) => new Date(s.startWall + m * 60000).toISOString()
  const wallIso = (m: number) => new Date(s.startWall + (m * 60000) / TIME_SCALE).toISOString()

  function start(minutesAgo: number): OutageMeta {
    s.startWall = Date.now() - (minutesAgo * 60000) / TIME_SCALE
    const started = new Date(s.startWall)
    const stamp = started.toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-')
    s.outage = {
      outage_id: `O-${stamp}`,
      zone_id: MOCK_ZONE.zone_id,
      zone_name: MOCK_ZONE.zone_name,
      status: 'ACTIVE',
      started_at: started.toISOString(),
      ended_at: null,
      time_scale: TIME_SCALE,
    }
    s.frozenAt = null
    s.overrides.clear()
    s.taskStatus.clear()
    s.planTasks = []
    s.briefs.clear()
    s.approved.clear()
    s.audit = []
    return { ...s.outage }
  }

  const preset = new URLSearchParams(window.location.search).get('mock')
  if (preset) start(preset === 'running' ? 47 : Number(preset) || 47)

  function requireOutage(outageId: string): OutageMeta {
    if (!s.outage || s.outage.outage_id !== outageId) {
      throw new ApiError(404, 'OUTAGE_NOT_FOUND', `No outage ${outageId}`)
    }
    return s.outage
  }

  function audit(action: AuditAction, fields: Partial<AuditEntry> = {}, wall = Date.now()) {
    const ts = new Date(wall).toISOString()
    s.audit.push({
      outage_id: s.outage!.outage_id,
      audit_sk: `${ts}#${action}-${s.audit.length}`,
      actor: OPERATOR,
      action,
      resident_id: null,
      rule_id: null,
      inputs_hash: null,
      before: null,
      after: null,
      reason: null,
      ...fields,
    })
  }

  // ---- derived state at demo minute t ----

  function attemptsFor(rid: string, t: number): AttemptState[] {
    return (SCRIPTS[rid] ?? [])
      .filter((a) => a.dialAt <= t)
      .map((a, i) => {
        const endAt = a.dialAt + a.duration
        const finished = t >= endAt
        const status: CallStatus = a.answered
          ? t < a.dialAt + 0.5 ? 'RINGING' : 'ANSWERED'
          : finished ? 'NO_ANSWER' : 'RINGING'
        const call_id = `${s.outage!.outage_id}:${rid}:${i + 1}`
        const decided = a.answered && finished
        const override = s.overrides.get(call_id)
        return {
          script: a,
          attempt: i + 1,
          call_id,
          status,
          finished,
          decided,
          triage: decided ? (override?.triage ?? a.triage ?? null) : null,
          rule_id: decided ? (override ? 'OVERRIDE' : (a.rule_id ?? null)) : null,
          endAt,
        }
      })
  }

  function groupOf(atts: AttemptState[]): TriageGroup {
    const last = atts.filter((a) => a.decided).at(-1)
    if (last?.triage) return last.triage
    const missed = atts.filter((a) => !a.script.answered && a.finished).length
    return missed >= 2 ? 'UNREACHED' : 'PENDING'
  }

  function deadlineOf(atts: AttemptState[]): number | null {
    const x = atts.filter((a) => a.decided).at(-1)
    const e = x?.script.extracted
    if (!x || e?.device_has_power !== 'on_battery' || e.battery_hours === null) return null
    return x.endAt + e.battery_hours * 60
  }

  function hospitalName(id: string) {
    return HOSPITALS.features.find((f) => f.properties.hospital_id === id)?.properties.name ?? id
  }

  function rowsAt(t: number): PriorityRow[] {
    const unranked = RESIDENTS.map((r) => {
      const atts = attemptsFor(r.resident_id, t)
      const last = atts.filter((a) => a.decided).at(-1)
      const deadline = deadlineOf(atts)
      return {
        resident_id: r.resident_id,
        first_name: r.first_name,
        zone_id: r.zone_id,
        lat: r.lat,
        lng: r.lng,
        language: r.language,
        risk_tier: r.risk_tier,
        device_type: r.device_type,
        triage_group: groupOf(atts),
        triage: last?.triage ?? null,
        rule_id: last?.rule_id ?? null,
        attempts: atts.length,
        last_call_status: atts.at(-1)?.status ?? null,
        battery_deadline_sim: deadline === null ? null : simIso(deadline),
        minutes_to_battery_deadline: deadline === null ? null : Math.round(deadline - t),
        simulated: r.simulated,
        // The geo Lambda fills hospital access a moment after the outage starts.
        hospital_access:
          t < 1.5
            ? null
            : {
                hospital_id: r.access.hospital_id,
                hospital_name: hospitalName(r.access.hospital_id),
                drive_minutes: r.access.drive_minutes,
                distance_km: r.access.distance_km,
                basis: r.access.basis,
                computed_at: wallIso(1.5),
              },
      }
    })
    return rankRows(unranked)
  }

  function callRows(t: number): CallRow[] {
    return RESIDENTS.flatMap((r) =>
      attemptsFor(r.resident_id, t).map((a) => ({
        call_id: a.call_id,
        outage_id: s.outage!.outage_id,
        resident_id: r.resident_id,
        attempt: a.attempt,
        kind: a.script.kind,
        status: a.status,
        triage: a.triage,
        rule_id: a.rule_id,
        language: r.language,
        simulated: r.simulated,
        started_at: wallIso(a.script.dialAt),
        ended_at: a.finished ? wallIso(a.endAt) : null,
      })),
    ).sort((a, b) => b.started_at.localeCompare(a.started_at))
  }

  function systemTasks(t: number): Task[] {
    return RESIDENTS.flatMap((r) =>
      attemptsFor(r.resident_id, t)
        .filter((a) => a.finished && a.script.tasks)
        .flatMap((a) =>
          a.script.tasks!.map((spec) => {
            const task_id = `T-${r.resident_id.slice(2)}-${a.attempt}-${spec.type}`
            const transport = spec.type === 'TRANSPORT'
            return {
              task_id,
              type: spec.type,
              resident_id: r.resident_id,
              outage_id: s.outage!.outage_id,
              priority: spec.priority,
              status: s.taskStatus.get(task_id) ?? 'OPEN',
              assigned_to: null,
              created_by: 'system',
              rule_id: a.script.rule_id ?? null,
              details: {
                need: spec.need,
                ...(transport && r.access.drive_minutes !== null
                  ? { hospital_name: hospitalName(r.access.hospital_id), drive_minutes: r.access.drive_minutes }
                  : {}),
              },
              created_at: wallIso(a.endAt),
            } satisfies Task
          }),
        ),
    )
  }

  function tasksAt(t: number): Task[] {
    const plan = s.planTasks.map((task) => ({ ...task, status: s.taskStatus.get(task.task_id) ?? task.status }))
    return [...systemTasks(t), ...plan].sort(
      (a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at),
    )
  }

  function auditAt(t: number): AuditEntry[] {
    const id = s.outage!.outage_id
    const entry = (wall: string, action: AuditAction, fields: Partial<AuditEntry>, eventId = fields.resident_id ?? 'outage'): AuditEntry => ({
      outage_id: id,
      audit_sk: `${wall}#${action}-${eventId}`,
      actor: 'system',
      action,
      resident_id: null,
      rule_id: null,
      inputs_hash: null,
      before: null,
      after: null,
      reason: null,
      ...fields,
    })
    const derived: AuditEntry[] = [entry(wallIso(0), 'OUTAGE_STARTED', { actor: OPERATOR })]
    for (const r of RESIDENTS) {
      for (const a of attemptsFor(r.resident_id, t)) {
        const rid = r.resident_id
        derived.push(entry(wallIso(a.script.dialAt), 'CALL_PLACED', { resident_id: rid, after: { attempt: a.attempt, kind: a.script.kind } }, a.call_id))
        if (a.decided) {
          derived.push(entry(wallIso(a.endAt), 'TRIAGE_DECIDED', {
            resident_id: rid,
            rule_id: a.script.rule_id ?? null,
            after: { triage: a.script.triage ?? null },
            inputs_hash: `sha256:${(rid + a.attempt).split('').map((c) => c.charCodeAt(0).toString(16)).join('').slice(0, 16)}`,
          }, a.call_id))
        }
      }
    }
    for (const task of systemTasks(t)) {
      derived.push(entry(task.created_at, 'TASK_CREATED', { resident_id: task.resident_id, rule_id: task.rule_id, after: { type: task.type } }, task.task_id))
    }
    return [...derived, ...s.audit].sort((a, b) => b.audit_sk.localeCompare(a.audit_sk))
  }

  // ---- copilot (mock: templated from live rows, no model call) ----

  function buildBrief(t: number): Brief {
    const rows = rowsAt(t)
    const count = (g: TriageGroup) => rows.filter((r) => r.triage_group === g).length
    const soon = rows.filter((r) => r.minutes_to_battery_deadline !== null && r.minutes_to_battery_deadline <= 180)
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
    const headline = `${MOCK_ZONE.zone_name}: ${plural(count('URGENT'), 'resident is', 'residents are')} urgent, ${plural(count('UNREACHED'), 'resident has', 'residents have')} not answered after two calls, and ${plural(soon.length, 'battery runs', 'batteries run')} out within 3 hours.`

    const candidates = rows.filter((r) => ['URGENT', 'HUMAN_REVIEW', 'UNREACHED', 'NEEDS_HELP'].includes(r.triage_group)).slice(0, 6)
    const priorities: BriefPriority[] = candidates.map((r, i) => {
      const prev = candidates[i - 1]
      const next = candidates[i + 1]
      const hosp = r.hospital_access
      const drive = hosp?.drive_minutes ?? undefined
      const runsOut = r.battery_deadline_sim ? clock(r.battery_deadline_sim) : null
      let reason: string
      if (r.rule_id === 'R0') {
        reason = 'Reported trouble breathing on the call (rule R0). The call was transferred to a responder; confirm someone is on the way.'
      } else if (r.rule_id === 'OVERRIDE') {
        reason = 'An operator set this triage by hand. Check the reason in the decision log before dispatching.'
      } else if (r.triage_group === 'UNREACHED') {
        reason = 'No answer after two calls. A welfare check is open and nobody is assigned yet.'
      } else if (r.rule_id === 'R4') {
        reason = 'The answers were unclear (rule R4), so a person needs to call back before anyone decides.'
      } else if (r.rule_id === 'R2' && runsOut) {
        reason = `Tier ${r.risk_tier}, on battery, runs out around ${runsOut} on the demo clock.`
        if (next && driveTieBreak(r, next) && drive !== undefined) {
          reason += ` Listed before ${next.resident_id}, whose battery runs out in the same half hour, because the drive to ${hosp!.hospital_name} is longer: ${drive} min versus ${next.hospital_access?.drive_minutes} min.`
        } else if (prev && driveTieBreak(prev, r)) {
          reason += ` Same half hour as ${prev.resident_id}, but closer to the hospital.`
        }
      } else if (r.rule_id === 'R6') {
        reason = 'Needs food. The device has power.'
      } else {
        reason = 'Needs medicine and transport; the medicine has to stay cold.'
      }
      const withHospital = hosp && (r.triage_group === 'URGENT' || r.rule_id === 'R5') && r.rule_id !== 'R0'
      return {
        rank: r.rank,
        resident_ids: [r.resident_id],
        reason,
        ...(withHospital
          ? { nearest_hospital: { hospital_id: hosp.hospital_id, name: hosp.hospital_name }, drive_minutes: drive }
          : {}),
      }
    })

    const tasks = systemTasks(t)
    const needsTransport = (rid: string) => tasks.some((x) => x.resident_id === rid && x.type === 'TRANSPORT')
    const urgentStops = rows
      .filter((r) => r.triage_group === 'URGENT' && r.rule_id !== 'R0')
      .slice(0, 3)
      .map((r) => ({ resident_id: r.resident_id, task_type: (needsTransport(r.resident_id) ? 'TRANSPORT' : 'CHARGING') as TaskType }))
    const teamB = [
      ...rows.filter((r) => r.triage_group === 'UNREACHED').map((r) => ({ resident_id: r.resident_id, task_type: 'WELFARE_CHECK' as TaskType })),
      ...rows.filter((r) => r.rule_id === 'R5').map((r) => ({ resident_id: r.resident_id, task_type: 'TRANSPORT' as TaskType })),
    ].slice(0, 3)

    const open_questions = [
      ...rows
        .filter((r) => r.hospital_access?.basis === 'straight_line')
        .map((r) => `${r.resident_id}'s distance is a straight-line estimate because routing was unavailable for that address.`),
      ...rows
        .filter((r) => r.rule_id === 'R4')
        .map((r) => `Who can call ${r.resident_id} back? Their answers were unclear.`),
    ]

    return {
      brief_id: `B-${Date.now().toString(36).toUpperCase()}`,
      outage_id: s.outage!.outage_id,
      zone_id: MOCK_ZONE.zone_id,
      generated_at: new Date().toISOString(),
      model_id: 'mock (no Bedrock call)',
      tool_calls: 4,
      reordered: false,
      headline,
      priorities,
      dispatch_plan: { teams: [{ team: 'A', stops: urgentStops }, { team: 'B', stops: teamB }].filter((x) => x.stops.length) },
      open_questions,
    }
  }

  function answer(question: string, t: number) {
    const rows = rowsAt(t)
    const q = question.toLowerCase()
    if (/(oxygen|tier 1)/.test(q) && /(reach|answer|contact)/.test(q)) {
      const hits = rows.filter((r) => r.risk_tier === 1 && (r.triage_group === 'UNREACHED' || r.triage_group === 'PENDING'))
      if (!hits.length) return { answer: `Every tier 1 resident in ${MOCK_ZONE.zone_name} has answered at least once.`, cited_resident_ids: [] }
      return {
        answer: `${hits.map((r) => `${r.resident_id} (${r.device_type.toLowerCase()})`).join(' and ')} ${hits.length === 1 ? 'has' : 'have'} not answered. ${hits.some((r) => r.triage_group === 'UNREACHED') ? 'A welfare check is open; no team is assigned yet.' : 'Calls are still being placed.'}`,
        cited_resident_ids: hits.map((r) => r.resident_id),
      }
    }
    if (/(battery|run out|runs out)/.test(q)) {
      const hits = rows.filter((r) => r.minutes_to_battery_deadline !== null).slice(0, 4)
      return {
        answer: hits.length
          ? `In priority order: ${hits.map((r) => `${r.resident_id} runs out around ${clock(r.battery_deadline_sim!)}, in ${span(r.minutes_to_battery_deadline!)}`).join('; ')}.`
          : 'No resident has reported a battery deadline yet.',
        cited_resident_ids: hits.map((r) => r.resident_id),
      }
    }
    const urgent = rows.filter((r) => r.triage_group === 'URGENT')
    return {
      answer: `I can only answer from the live call data. Right now ${urgent.length} residents are urgent in ${MOCK_ZONE.zone_name}: ${urgent.map((r) => r.resident_id).join(', ') || 'none'}.`,
      cited_resident_ids: urgent.map((r) => r.resident_id),
    }
  }

  // ---- route geometry (mock: a street-like path, not a real route) ----

  function streetPath(a: [number, number], b: [number, number]): [number, number][] {
    const [ax, ay] = a
    const [bx, by] = b
    const dx = bx - ax
    const dy = by - ay
    return [
      a,
      [ax + dx * 0.08, ay],
      [ax + dx * 0.08, ay + dy * 0.3],
      [ax + dx * 0.55, ay + dy * 0.34],
      [ax + dx * 0.62, ay + dy * 0.78],
      [bx - dx * 0.04, ay + dy * 0.8],
      [bx - dx * 0.04, by],
      b,
    ]
  }

  function findResident(rid: string): MockResident {
    const r = RESIDENTS.find((x) => x.resident_id === rid)
    if (!r) throw new ApiError(404, 'RESIDENT_NOT_FOUND', `No resident ${rid}`)
    return r
  }

  function findAttempt(callId: string): { resident: MockResident; attempt: AttemptState } {
    const [, rid, n] = callId.split(':')
    const resident = findResident(rid)
    const attempt = attemptsFor(rid, simNow()).find((a) => a.attempt === Number(n))
    if (!attempt) throw new ApiError(404, 'CALL_NOT_FOUND', `No call ${callId}`)
    return { resident, attempt }
  }

  function setTaskStatus(taskId: string, status: TaskStatus, action: AuditAction): Task {
    const task = tasksAt(simNow()).find((x) => x.task_id === taskId)
    if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', `No task ${taskId}`)
    s.taskStatus.set(taskId, status)
    audit(action, { resident_id: task.resident_id, before: { status: task.status }, after: { status } })
    return { ...task, status }
  }

  const fairness = (residents: MockResident[], t: number): FairnessMetric => {
    const contacts = residents
      .map((r) => attemptsFor(r.resident_id, t).find((a) => a.script.answered && a.status === 'ANSWERED'))
      .filter((a): a is AttemptState => !!a)
      .map((a) => a.script.dialAt + 0.5)
      .sort((x, y) => x - y)
    const mid = contacts.length ? contacts[Math.floor((contacts.length - 1) / 2)] : null
    return {
      contact_rate: residents.length ? contacts.length / residents.length : 0,
      median_minutes_to_contact: mid === null ? null : Math.round(mid),
      // From eval/report.json in the real API: 30 scenarios per language, 0 missed.
      missed_urgent_rate: 0,
    }
  }

  // ---- the Api ----

  return {
    async getActiveOutage(o) {
      await sleep(jitter(60, 160), o?.signal)
      return { outage: s.outage?.status === 'ACTIVE' ? { ...s.outage } : null }
    },

    async startOutage(zoneId) {
      await sleep(jitter(250, 450))
      if (s.outage?.status === 'ACTIVE') {
        throw new ApiError(409, 'OUTAGE_ACTIVE', `${s.outage.zone_name} already has an active outage.`)
      }
      if (zoneId !== MOCK_ZONE.zone_id) {
        throw new ApiError(400, 'MOCK_ZONE_ONLY', 'Mock data covers Zone 2 only. Choose Zone 2, or connect the live API.')
      }
      const outage = start(0)
      audit('OUTAGE_STARTED')
      return outage
    },

    async endOutage(outageId) {
      await sleep(jitter(250, 450))
      const outage = requireOutage(outageId)
      s.frozenAt = simNow()
      outage.status = 'ENDED'
      outage.ended_at = new Date().toISOString()
      audit('OUTAGE_ENDED')
      return { ...outage }
    },

    async getSummary(outageId, o) {
      await sleep(jitter(80, 200), o?.signal)
      requireOutage(outageId)
      const t = simNow()
      const rows = rowsAt(t)
      const reachedIds = new Set(
        RESIDENTS.filter((r) => attemptsFor(r.resident_id, t).some((a) => a.script.answered && a.status === 'ANSWERED')).map((r) => r.resident_id),
      )
      const called = RESIDENTS.filter((r) => attemptsFor(r.resident_id, t).length > 0).length
      const count = (g: TriageGroup) => rows.filter((r) => r.triage_group === g).length
      const by_language: Partial<Record<Language, { called: number; reached: number }>> = {}
      for (const r of RESIDENTS) {
        const entry = (by_language[r.language] ??= { called: 0, reached: 0 })
        if (attemptsFor(r.resident_id, t).length) entry.called++
        if (reachedIds.has(r.resident_id)) entry.reached++
      }
      return {
        outage_id: outageId,
        sim_now: simIso(t),
        wall_now: new Date().toISOString(),
        totals: {
          residents: RESIDENTS.length,
          called,
          reached: reachedIds.size,
          urgent: count('URGENT'),
          review: count('HUMAN_REVIEW'),
          unreached: count('UNREACHED'),
        },
        zones: [{
          ...MOCK_ZONE,
          residents: RESIDENTS.length,
          called,
          reached: reachedIds.size,
          urgent: count('URGENT'),
          unreached: count('UNREACHED'),
          pct_contacted: Math.round((reachedIds.size / RESIDENTS.length) * 100),
        }],
        by_language,
      }
    },

    async getPriority(outageId, o) {
      await sleep(jitter(80, 220), o?.signal)
      requireOutage(outageId)
      const t = simNow()
      return { generated_at: new Date().toISOString(), sim_now: simIso(t), rows: rowsAt(t) }
    },

    async getCalls(outageId, o) {
      await sleep(jitter(60, 180), o?.signal)
      requireOutage(outageId)
      return { items: callRows(simNow()) }
    },

    async getTimeline(residentId, outageId, o) {
      await sleep(jitter(120, 300), o?.signal)
      requireOutage(outageId)
      const t = simNow()
      const r = findResident(residentId)
      const atts = attemptsFor(residentId, t)
      const upcoming = (SCRIPTS[residentId] ?? []).find((a) => a.dialAt > t)
      const lastDecided = atts.filter((a) => a.decided).at(-1)
      const scheduled = lastDecided?.script.nextCheckIn ? lastDecided.endAt + lastDecided.script.nextCheckIn : null
      const next = upcoming && atts.length ? upcoming.dialAt : scheduled
      const { simulated: _s, access: _a, ...resident } = r
      return {
        resident,
        attempts: atts.map((a) => {
          const turns = a.script.turns ?? []
          const live = a.script.answered && !a.finished
          const progress = live ? Math.max(0, (t - a.script.dialAt - 0.5) / (a.script.duration - 0.5)) : 1
          return {
            call_id: a.call_id,
            attempt: a.attempt,
            kind: a.script.kind,
            status: a.status,
            started_at: wallIso(a.script.dialAt),
            transcript_redacted: a.status === 'RINGING' ? [] : turns.slice(0, Math.ceil(turns.length * progress)),
            extracted: a.decided ? (a.script.extracted ?? null) : null,
            triage: a.triage,
            rule_id: a.rule_id,
            next_check_at_sim: a.decided && a.script.nextCheckIn ? simIso(a.endAt + a.script.nextCheckIn) : null,
          }
        }),
        next_check_at_sim: next !== null && next !== undefined && next > t ? simIso(next) : null,
      }
    },

    async getHospitalRoute(residentId, outageId, o) {
      await sleep(jitter(450, 900), o?.signal)
      requireOutage(outageId)
      const r = findResident(residentId)
      const h = HOSPITALS.features.find((f) => f.properties.hospital_id === r.access.hospital_id)!
      const from: [number, number] = [r.lng, r.lat]
      const to = h.geometry.coordinates
      const straight = r.access.basis === 'straight_line'
      return {
        resident_id: residentId,
        hospital: { hospital_id: h.properties.hospital_id, name: h.properties.name, address: h.properties.address, phone: h.properties.phone },
        drive_minutes: r.access.drive_minutes,
        distance_km: r.access.distance_km,
        basis: r.access.basis,
        computed_at: new Date().toISOString(),
        geometry: { type: 'LineString', coordinates: straight ? [from, to] : streetPath(from, to) },
      } satisfies HospitalRoute
    },

    async getTasks(outageId, o) {
      await sleep(jitter(80, 200), o?.signal)
      requireOutage(outageId)
      return { items: tasksAt(simNow()) }
    },

    async ackTask(taskId) {
      await sleep(jitter(150, 300))
      return setTaskStatus(taskId, 'ACK', 'TASK_ACK')
    },

    async doneTask(taskId) {
      await sleep(jitter(150, 300))
      return setTaskStatus(taskId, 'DONE', 'TASK_DONE')
    },

    async overrideCall(callId, triage, reason) {
      await sleep(jitter(200, 400))
      if (!reason.trim()) throw new ApiError(400, 'REASON_REQUIRED', 'An override needs a reason.')
      const { resident, attempt } = findAttempt(callId)
      if (!attempt.decided) throw new ApiError(409, 'NOT_DECIDED', 'This call has no triage to override yet.')
      s.overrides.set(callId, { triage })
      audit('OVERRIDE', {
        resident_id: resident.resident_id,
        rule_id: 'OVERRIDE',
        before: { triage: attempt.triage, rule_id: attempt.rule_id },
        after: { triage, rule_id: 'OVERRIDE' },
        reason: reason.trim(),
      })
      const row = callRows(simNow()).find((c) => c.call_id === callId)!
      return row
    },

    async getAudit(outageId, o) {
      await sleep(jitter(80, 200), o?.signal)
      requireOutage(outageId)
      return { items: auditAt(simNow()) }
    },

    async getFairness(outageId, o) {
      await sleep(jitter(100, 250), o?.signal)
      requireOutage(outageId)
      const t = simNow()
      const by_language: Partial<Record<Language, FairnessMetric>> = {}
      for (const lang of ['en', 'es', 'hi'] as const) {
        by_language[lang] = fairness(RESIDENTS.filter((r) => r.language === lang), t)
      }
      return { by_language, by_zone: { [MOCK_ZONE.zone_id]: fairness(RESIDENTS, t) } }
    },

    async copilotBrief(outageId) {
      requireOutage(outageId)
      await sleep(jitter(2400, 3200))
      const brief = buildBrief(simNow())
      s.briefs.set(brief.brief_id, brief)
      audit('BRIEF_GENERATED', { after: { brief_id: brief.brief_id } })
      return brief
    },

    async copilotAsk(outageId, question) {
      requireOutage(outageId)
      await sleep(jitter(1400, 2000))
      return { ...answer(question, simNow()), tool_calls: 2 }
    },

    async copilotApprove(outageId, briefId) {
      requireOutage(outageId)
      await sleep(jitter(300, 500))
      const brief = s.briefs.get(briefId)
      if (!brief) throw new ApiError(404, 'BRIEF_NOT_FOUND', `No brief ${briefId}`)
      if (!s.approved.has(briefId)) {
        s.approved.add(briefId)
        const now = new Date().toISOString()
        for (const team of brief.dispatch_plan.teams) {
          team.stops.forEach((stop, i) => {
            s.planTasks.push({
              task_id: `T-plan-${briefId}-${team.team}-${i + 1}`,
              type: stop.task_type,
              resident_id: stop.resident_id,
              outage_id: outageId,
              priority: stop.task_type === 'WELFARE_CHECK' || team.team === 'A' ? 1 : 2,
              status: 'OPEN',
              assigned_to: `Team ${team.team}`,
              created_by: `plan:${briefId}`,
              rule_id: null,
              details: { team: team.team, stop_no: i + 1 },
              created_at: now,
            })
          })
        }
        audit('PLAN_APPROVED', { after: { brief_id: briefId, tasks: s.planTasks.filter((x) => x.created_by === `plan:${briefId}`).length } })
      }
      return { tasks: s.planTasks.filter((x) => x.created_by === `plan:${briefId}`) }
    },

    async getHospitals(o) {
      await sleep(jitter(40, 120), o?.signal)
      return HOSPITALS
    },
  }
}
