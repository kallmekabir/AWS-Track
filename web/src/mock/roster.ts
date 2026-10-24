// The Zone A demo roster from backend/app/seed.py, with scripted calls for mock mode.
// Everything here is made up. The first four outcomes are the worked example in
// docs/RANKING.md (Daniel R1, Ruth R2, Maria R3, Linh R5); the other four cover R4, R6,
// another R3 and NA (no answer twice).
//
// Mock mode plays the whole pipeline, including Phase 2 (Bedrock facts, drive time,
// round 2 ranking), which the real backend doesn't do yet. In the real demo only the
// four teammate personas are callable; here all eight are, so the line refill shows.
import type { Ai, Facts, Status } from '../api'

/** Word for word from backend/app/script.py (QUESTIONS). */
export const QUESTIONS = [
  'Hi, this is CareCall from County Public Health, checking on you during the power outage. Are you safe right now?',
  'Is your medical device working right now?',
  'How many full backup tanks or batteries do you have?',
  'About how many hours can you go before you run out?',
  'Do you need anything else, like medicine, food, a ride, a place to charge, or an oxygen delivery?',
]

export interface MockPerson {
  id: string
  name: string
  phone: string
  address: string
  lat: number
  lng: number
  device: string
  device_group: number
  backups_on_file: number
  backup_hours_each: number
  /** Drive from the nearest supplier (Phase 2, app/location.py). */
  drive_minutes: number | null
  /** The five answers, or null when the person never picks up. */
  answers: string[] | null
  /** Extra seconds this call takes, so calls don't all end together. */
  extra: number
  result?: { status: Status; rule_id: string; reason: string; hours_left: number | null; facts?: Facts; ai?: Ai }
}

const person = (p: Omit<MockPerson, 'phone'> & { phone4: string }): MockPerson => {
  const { phone4, ...rest } = p
  return { ...rest, phone: `+1-XXX-XXX-${phone4}` }
}

export const ROSTER: MockPerson[] = [
  person({
    id: 'r-001', name: 'Daniel Kim', phone4: '0102', address: '88 Oak Ave, San Jose, CA',
    lat: 37.342, lng: -121.889, device: 'Home ventilator', device_group: 1,
    backups_on_file: 0, backup_hours_each: 4, drive_minutes: 25, extra: 0,
    answers: [
      "I'm okay for now, but the machine stopped.",
      "No. It's off, and the backup didn't kick in.",
      'None. That was the only one.',
      "I don't know. Not long.",
      "Someone needs to come out. I can't fix it myself.",
    ],
    result: { status: 'HELP_NOW', rule_id: 'R1', reason: 'Device off, no backups left', hours_left: 0 },
  }),
  person({
    id: 'r-002', name: 'Ruth Okafor', phone4: '0103', address: '9 Birch Ct, San Jose, CA',
    lat: 37.338, lng: -121.886, device: 'Oxygen concentrator', device_group: 1,
    backups_on_file: 1, backup_hours_each: 2, drive_minutes: 70, extra: 2,
    answers: [
      "Yes, I'm okay.",
      "Yes, it's on the tank now.",
      'Just one tank left.',
      'About two hours, I think.',
      "Someone to bring more oxygen. I can't get there in time.",
    ],
    result: { status: 'HELP_NOW', rule_id: 'R2', reason: 'Supplier 70 min away, 50 min to spare', hours_left: 2,
      facts: { safe: 'yes', device_working: 'yes', backup_left: 1, hours_left: 2, needs: ['oxygen_delivery'], emergency: false, confidence: 0.9 },
      ai: { model_id: 'us.amazon.nova-lite-v1:0', latency_ms: 712, ok: true, problems: [] } },
  }),
  person({
    id: 'r-003', name: 'Maria Lopez', phone4: '0101', address: '412 Elm St, San Jose, CA',
    lat: 37.335, lng: -121.893, device: 'Oxygen concentrator', device_group: 1,
    backups_on_file: 2, backup_hours_each: 2, drive_minutes: 15, extra: 1,
    answers: [
      "Yeah, I'm okay.",
      "It's working. It's on the tank.",
      'One tank.',
      'Maybe two hours.',
      "I can't drive to get more.",
    ],
    result: { status: 'HELP_SOON', rule_id: 'R3', reason: '1 backup left', hours_left: 2,
      facts: { safe: 'yes', device_working: 'yes', backup_left: 1, hours_left: 2, needs: ['transport'], emergency: false, confidence: 0.88 },
      ai: { model_id: 'us.amazon.nova-lite-v1:0', latency_ms: 668, ok: true, problems: [] } },
  }),
  person({
    id: 'r-004', name: 'Linh Tran', phone4: '0121', address: '57 Maple Dr, San Jose, CA',
    lat: 37.329, lng: -121.89, device: 'Oxygen concentrator', device_group: 1,
    backups_on_file: 3, backup_hours_each: 3, drive_minutes: 20, extra: 3,
    answers: ["I'm fine.", "Yes, it's working.", 'Three tanks.', 'Around nine hours.', 'A place to charge would help.'],
    result: { status: 'NEEDS_SUPPLIES', rule_id: 'R5', reason: 'Needs charging', hours_left: 9 },
  }),
  person({
    id: 'r-005', name: 'Samuel Reyes', phone4: '0114', address: '230 Cedar Ln, San Jose, CA',
    lat: 37.331, lng: -121.897, device: 'Home dialysis', device_group: 2,
    backups_on_file: 1, backup_hours_each: 4, drive_minutes: 30, extra: 0,
    answers: null,
  }),
  person({
    id: 'r-006', name: 'Alice Moore', phone4: '0109', address: '301 Pine St, San Jose, CA',
    lat: 37.344, lng: -121.895, device: 'Infusion pump', device_group: 2,
    backups_on_file: 2, backup_hours_each: 6, drive_minutes: 30, extra: 2,
    answers: [
      'Uh, I think so?',
      "It's on something. The light is blinking.",
      "I'm not sure what you mean.",
      'A while, I guess.',
      "I don't know. Maybe my son knows.",
    ],
    result: { status: 'PERSON_CHECK', rule_id: 'R4', reason: 'Answers unclear', hours_left: null,
      facts: { safe: 'unsure', device_working: 'unsure', backup_left: null, hours_left: null, needs: [], emergency: false, confidence: 0.35 },
      ai: { model_id: 'us.amazon.nova-lite-v1:0', latency_ms: 731, ok: true, problems: ['hours_left: null is not valid'] } },
  }),
  person({
    id: 'r-007', name: 'George Patel', phone4: '0127', address: '16 Walnut St, San Jose, CA',
    lat: 37.34, lng: -121.881, device: 'CPAP machine', device_group: 3,
    backups_on_file: 1, backup_hours_each: 8, drive_minutes: 20, extra: 1,
    answers: ['Yes.', "It's running on the battery.", 'Two batteries.', 'About three hours.', 'No, nothing else.'],
    result: { status: 'HELP_SOON', rule_id: 'R3', reason: '3 h left', hours_left: 3 },
  }),
  person({
    id: 'r-008', name: 'Henry Wu', phone4: '0133', address: '74 Spruce Ave, San Jose, CA',
    lat: 37.328, lng: -121.884, device: 'Powered wheelchair', device_group: 3,
    backups_on_file: 1, backup_hours_each: 10, drive_minutes: 35, extra: 0,
    answers: ['All good here.', 'Yes, fully charged.', 'One spare battery.', 'Eight hours, easy.', 'Nothing needed, thanks.'],
    // The reason gets its recheck time when the call ends (docs/RANKING.md, recheck_at).
    result: { status: 'OK_FOR_NOW', rule_id: 'R6', reason: 'Enough supply. Calling again at', hours_left: 8 },
  }),
]
