// Plain words for every level and rule the backend sends. Wording follows
// docs/RANKING.md and CLAUDE.md section 3; keep them in step with app/ranking.py.
import type { Resident, Status } from '../api'

export const LEVEL_LABEL: Record<Status, string> = {
  HELP_NOW: 'Help now',
  HELP_SOON: 'Help soon',
  PERSON_CHECK: 'A person must check',
  NEEDS_SUPPLIES: 'Needs supplies',
  OK_FOR_NOW: 'OK for now',
  CALLING: 'Calling now',
  NOT_CALLED: 'Not called yet',
}

/** Legend order: the same order as the dashboard list (docs/RANKING.md). */
export const LEVEL_ORDER: Status[] = [
  'HELP_NOW',
  'HELP_SOON',
  'PERSON_CHECK',
  'NEEDS_SUPPLIES',
  'OK_FOR_NOW',
  'CALLING',
  'NOT_CALLED',
]

/** What each rule checks, from the round 2 table in docs/RANKING.md. */
export const RULE_TEXT: Record<string, string> = {
  R0: 'Said it is an emergency, or said they are not safe',
  R1: 'Device off and no backups left',
  R2: 'Less than 1 hour to spare after the hospital drive',
  R3: 'One backup left, or under 4 hours left',
  R4: 'Answers unclear, or hours unknown for an oxygen or ventilator user',
  R5: 'Asked for supplies',
  R6: 'Enough supply for now; a recheck is booked',
  NA: 'No answer after 2 calls; send a welfare check',
}

/** "R2 · Hospital 70 min away, 50 min to spare" (CLAUDE.md section 3). */
export function reasonLine(r: Resident): string | null {
  const parts = [r.rule_id, r.reason].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/** Live call progress, or null when the person is not on a call. */
export function callProgress(r: Resident): string | null {
  if (r.status !== 'CALLING') return null
  return r.current_question > 0 ? `Question ${r.current_question} of 5` : 'Ringing'
}

/** Call again is offered once a person has been called and isn't on a call now (as in main's App). */
export function canCallAgain(r: Resident): boolean {
  return r.allow_call && r.status !== 'CALLING' && r.status !== 'NOT_CALLED'
}

/** Plain words for the needs Bedrock heard (docs/RANKING.md NEED_WORDS). */
export const NEED_TEXT: Record<string, string> = {
  medicine: 'medicine',
  food: 'food',
  transport: 'a ride',
  charging: 'a place to charge',
  oxygen_delivery: 'an oxygen delivery',
}

/** "yes" / "no" / "not sure" for the three-way fact fields. */
export function yesNoText(v: 'yes' | 'no' | 'unsure'): string {
  return v === 'unsure' ? 'not sure' : v
}

export const DEVICE_GROUP_TEXT: Record<number, string> = {
  1: 'Group 1: oxygen or ventilator',
  2: 'Group 2: dialysis or infusion',
  3: 'Group 3: other devices',
}

/** Round 1 calling order in plain words; the group number stays in the DEVICE_GROUP_TEXT tooltip. */
const DEVICE_GROUP_ORDER: Record<number, string> = {
  1: 'breathing device, called first',
  2: 'called second',
  3: 'called third',
}

/** "Oxygen concentrator · breathing device, called first · 1 backup on file" (main's list wording). */
export function deviceLine(r: Resident): string {
  const backups =
    r.backups_on_file === null ? '' : ` · ${r.backups_on_file} ${r.backups_on_file === 1 ? 'backup' : 'backups'} on file`
  const order = DEVICE_GROUP_ORDER[r.device_group] ?? `group ${r.device_group}`
  return `${r.device} · ${order}${backups}`
}
