// TypeScript mirrors of the REST contract (task graph C8) and the copilot brief (C9).
// All times are ISO 8601 UTC. Fields ending in _sim are on the demo clock.

export type Language = 'en' | 'es' | 'hi'
export type RiskTier = 1 | 2 | 3

export type CallStatus =
  | 'QUEUED'
  | 'RINGING'
  | 'ANSWERED'
  | 'NO_ANSWER'
  | 'NO_RESPONSE'
  | 'PARTIAL'
  | 'FAILED'
  | 'OPTED_OUT'

export type CallKind = 'INITIAL' | 'RETRY' | 'RECHECK'
export type Triage = 'URGENT' | 'HUMAN_REVIEW' | 'NEEDS_HELP' | 'SAFE'
export type TriageGroup = 'URGENT' | 'HUMAN_REVIEW' | 'UNREACHED' | 'NEEDS_HELP' | 'PENDING' | 'SAFE'

export type TaskType =
  | 'OPERATOR_ALERT'
  | 'HUMAN_REVIEW'
  | 'WELFARE_CHECK'
  | 'TRANSPORT'
  | 'CHARGING'
  | 'MEDICINE'
  | 'FOOD'
  | 'INFO_SMS'

export type TaskStatus = 'OPEN' | 'ACK' | 'DONE'

export type AuditAction =
  | 'OUTAGE_STARTED'
  | 'OUTAGE_ENDED'
  | 'CALL_PLACED'
  | 'CALL_SKIPPED'
  | 'TRIAGE_DECIDED'
  | 'TASK_CREATED'
  | 'TASK_ACK'
  | 'TASK_DONE'
  | 'OVERRIDE'
  | 'BRIEF_GENERATED'
  | 'PLAN_APPROVED'
  | 'OPT_OUT'
  | 'GUARDRAIL_BLOCKED'

export type DriveBasis = 'live_traffic' | 'straight_line'

export interface OutageMeta {
  outage_id: string
  zone_id: string
  zone_name: string
  status: 'ACTIVE' | 'ENDED'
  started_at: string
  ended_at: string | null
  time_scale: number
}

export interface ZoneSummary {
  zone_id: string
  zone_name: string
  residents: number
  called: number
  reached: number
  urgent: number
  unreached: number
  pct_contacted: number
}

export interface OutageSummary {
  outage_id: string
  sim_now: string
  wall_now: string
  totals: {
    residents: number
    called: number
    reached: number
    urgent: number
    review: number
    unreached: number
  }
  zones: ZoneSummary[]
  by_language: Partial<Record<Language, { called: number; reached: number }>>
}

export interface HospitalAccessSummary {
  hospital_id: string
  hospital_name: string
  drive_minutes: number | null
  distance_km: number
  basis: DriveBasis
  computed_at: string
}

export interface PriorityRow {
  rank: number
  resident_id: string
  first_name: string
  zone_id: string
  lat: number
  lng: number
  language: Language
  risk_tier: RiskTier
  device_type: string
  triage_group: TriageGroup
  triage: Triage | null
  rule_id: string | null
  attempts: number
  last_call_status: CallStatus | null
  battery_deadline_sim: string | null
  minutes_to_battery_deadline: number | null
  simulated: boolean
  hospital_access: HospitalAccessSummary | null
}

export interface PriorityResponse {
  generated_at: string
  sim_now: string
  rows: PriorityRow[]
}

export interface CallRow {
  call_id: string
  outage_id: string
  resident_id: string
  attempt: number
  kind: CallKind
  status: CallStatus
  triage: Triage | null
  rule_id: string | null
  language: Language
  simulated: boolean
  started_at: string
  ended_at: string | null
}

/** Bedrock extraction output, schemas/checkin.json. */
export interface CheckIn {
  is_safe: 'yes' | 'no' | 'unsure'
  device_has_power: 'yes' | 'no' | 'on_battery' | 'no_device' | 'unsure'
  battery_hours: number | null
  needs: Array<'medicine' | 'food' | 'transport' | 'charging' | 'none'>
  distress_signals: Array<'breathing_difficulty' | 'chest_pain' | 'fall' | 'confusion' | 'none'>
  language_detected: Language
  confidence: number
}

export interface TranscriptTurn {
  speaker: 'careline' | 'resident'
  text: string
}

export interface Attempt {
  call_id: string
  attempt: number
  kind: CallKind
  status: CallStatus
  started_at: string
  transcript_redacted: TranscriptTurn[]
  extracted: CheckIn | null
  triage: Triage | null
  rule_id: string | null
  next_check_at_sim: string | null
}

/** Residents item minus phone_e164, emergency_contact_phone and sim_scenarios. */
export interface ResidentPublic {
  resident_id: string
  first_name: string
  last_name: string
  language: Language
  zone_id: string
  zone_name: string
  risk_tier: RiskTier
  device_type: string
  consent: boolean
  opted_out: boolean
  lat: number
  lng: number
}

export interface ResidentTimeline {
  resident: ResidentPublic
  attempts: Attempt[]
  next_check_at_sim: string | null
}

export interface HospitalRoute {
  resident_id: string
  hospital: { hospital_id: string; name: string; address: string; phone?: string }
  drive_minutes: number | null
  distance_km: number
  basis: DriveBasis
  computed_at: string
  geometry: { type: 'LineString'; coordinates: [number, number][] }
}

export interface Task {
  task_id: string
  type: TaskType
  resident_id: string
  outage_id: string
  priority: 1 | 2 | 3 | 4
  status: TaskStatus
  assigned_to: string | null
  created_by: string
  rule_id: string | null
  details: {
    need?: string
    hospital_name?: string
    drive_minutes?: number
    team?: string
    stop_no?: number
  }
  created_at: string
}

export interface AuditEntry {
  outage_id: string
  audit_sk: string
  actor: string
  action: AuditAction
  resident_id: string | null
  rule_id: string | null
  inputs_hash: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  reason: string | null
}

export interface FairnessMetric {
  contact_rate: number
  median_minutes_to_contact: number | null
  missed_urgent_rate: number | null
}

export interface FairnessResponse {
  by_language: Partial<Record<Language, FairnessMetric>>
  by_zone: Record<string, FairnessMetric>
}

export interface BriefPriority {
  rank: number
  resident_ids: string[]
  reason: string
  nearest_hospital?: { hospital_id: string; name: string }
  drive_minutes?: number
}

export interface Brief {
  brief_id: string
  outage_id: string
  zone_id: string
  generated_at: string
  model_id: string
  tool_calls: number
  reordered: boolean
  headline: string
  priorities: BriefPriority[]
  dispatch_plan: {
    teams: Array<{ team: string; stops: Array<{ resident_id: string; task_type: TaskType }> }>
  }
  open_questions: string[]
}

export interface AskResponse {
  answer: string
  cited_resident_ids: string[]
  tool_calls: number
}

export interface ApiErrorBody {
  error: { code: string; message: string }
}

/** Hospitals come from the bundled /hospitals.geojson (built from data/hospitals.csv), not the API. */
export interface HospitalProperties {
  hospital_id: string
  name: string
  address: string
  city: string
  phone?: string
}

export interface HospitalCollection {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: HospitalProperties
  }>
}
