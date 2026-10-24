// Synthetic Zone 2 (East San Jose) outage for VITE_USE_MOCKS. Every resident, phone
// number and transcript here is invented. Hospital coordinates are approximate and
// the phones are 555 numbers; data/hospitals.csv is the source of truth (D01).
// Script lines follow the plan's script library; the Spanish and Hindi wording is
// placeholder text until the reviewed library (D06) lands.
import type {
  CallKind,
  CheckIn,
  DriveBasis,
  HospitalCollection,
  Language,
  ResidentPublic,
  TaskType,
  TranscriptTurn,
  Triage,
} from '../types'

export const TIME_SCALE = 60
export const MOCK_ZONE = { zone_id: 'Z2', zone_name: 'East San Jose' }

export const HOSPITALS: HospitalCollection = {
  type: 'FeatureCollection',
  features: [
    ['H-01', 'Regional Medical Center of San Jose', '225 N Jackson Ave', -121.8445, 37.3634, '(408) 555-0101'],
    ['H-02', 'Santa Clara Valley Medical Center', '751 S Bascom Ave', -121.9337, 37.3139, '(408) 555-0102'],
    ['H-03', "O'Connor Hospital", '2105 Forest Ave', -121.9357, 37.323, '(408) 555-0103'],
    ['H-04', 'Good Samaritan Hospital', '2425 Samaritan Dr', -121.9468, 37.2519, '(408) 555-0104'],
    ['H-05', 'Kaiser Permanente San Jose Medical Center', '250 Hospital Pkwy', -121.8, 37.24, '(408) 555-0105'],
  ].map(([hospital_id, name, address, lng, lat, phone]) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [lng as number, lat as number] as [number, number] },
    properties: { hospital_id: hospital_id as string, name: name as string, address: address as string, city: 'San Jose', phone: phone as string },
  })),
}

export interface MockResident extends ResidentPublic {
  simulated: boolean
  access: { hospital_id: string; drive_minutes: number | null; distance_km: number; basis: DriveBasis }
}

function resident(
  resident_id: string,
  first_name: string,
  last_name: string,
  language: Language,
  risk_tier: 1 | 2 | 3,
  device_type: string,
  lat: number,
  lng: number,
  access: MockResident['access'],
  simulated = true,
): MockResident {
  return {
    resident_id, first_name, last_name, language, risk_tier, device_type, lat, lng, access, simulated,
    zone_id: MOCK_ZONE.zone_id, zone_name: MOCK_ZONE.zone_name, consent: true, opted_out: false,
  }
}

const live = (drive_minutes: number, distance_km: number) =>
  ({ hospital_id: 'H-01', drive_minutes, distance_km, basis: 'live_traffic' as const })

export const RESIDENTS: MockResident[] = [
  resident('R-102', 'Anil', 'Sharma', 'hi', 1, 'Home ventilator', 37.3489, -121.8352, live(7, 2.1)),
  resident('R-108', 'Guadalupe', 'Torres', 'es', 2, 'Home dialysis', 37.353, -121.818, live(10, 3.6)),
  // R-114 and R-131 are the teammates' real phones in the demo, so they are not simulated.
  resident('R-114', 'Rosa', 'Martínez', 'es', 1, 'Oxygen concentrator', 37.3612, -121.825, live(9, 2.4), false),
  resident('R-120', 'Dolores', 'King', 'en', 1, 'Oxygen concentrator', 37.3425, -121.8098, live(12, 4.4)),
  resident('R-125', 'Linh', 'Tran', 'en', 2, 'Medicine refrigerator', 37.3701, -121.8102, live(11, 3.5)),
  resident('R-131', 'Walter', 'Briggs', 'en', 1, 'Oxygen concentrator', 37.3668, -121.7745, live(22, 9.4), false),
  resident('R-137', 'Harold', 'Okafor', 'en', 2, 'Home dialysis', 37.3355, -121.829, live(13, 4.0)),
  resident('R-142', 'Sunita', 'Rao', 'hi', 3, 'Power wheelchair', 37.357, -121.84, live(5, 1.0)),
  resident('R-149', 'Marcus', 'Bell', 'en', 3, 'Power wheelchair', 37.3463, -121.7905, live(14, 5.6)),
  // Routing "failed" for this address, so the UI shows the straight-line fallback.
  resident('R-153', 'Ernesto', 'Ruiz', 'es', 3, 'Mobility scooter', 37.332, -121.805,
    { hospital_id: 'H-01', drive_minutes: null, distance_km: 5.0, basis: 'straight_line' }),
]

// ---- Script library (fixed lines CareLine speaks) ----

const LINES = {
  en: {
    intro: "Hello [NAME], this is CareLine, an automated wellness check from your county emergency services. There is a power outage in your area. I'll ask three quick questions. Say 'person' at any time to reach a human, or 'stop' to opt out.",
    q1: 'Are you safe right now?',
    q2: 'Does your medical device have power, is it running on battery, or is it off?',
    q3: 'About how many hours of battery do you have left?',
    q4: 'Do you need medicine, food, transport, or a place to charge your device?',
    emergency: 'If this is an emergency, hang up and dial 911 now. I am connecting you to a responder.',
    urgent: 'Thank you. A county responder will call you back within minutes. The nearest charging center is Eastside Library at [ADDRESS], open until 9 PM.',
    help: 'Thank you. A county team will contact you today about what you need.',
    recheck: (h: number) => `Thank you. The nearest charging center is Eastside Library at [ADDRESS], open until 9 PM. I'll call you again in about ${h} hours.`,
  },
  es: {
    intro: "Hola [NAME], le llama CareLine, un control de bienestar automático de los servicios de emergencia de su condado. Hay un corte de luz en su zona. Le haré tres preguntas rápidas. Diga 'persona' en cualquier momento para hablar con alguien, o 'alto' para no recibir más llamadas.",
    q1: '¿Está a salvo en este momento?',
    q2: '¿Su equipo médico tiene electricidad, funciona con batería o está apagado?',
    q3: '¿Cuántas horas de batería le quedan, más o menos?',
    q4: '¿Necesita medicinas, comida, transporte o un lugar para cargar su equipo?',
    emergency: 'Si es una emergencia, cuelgue y marque 911 ahora. Le comunico con una persona del condado.',
    urgent: 'Gracias. Una persona del condado le llamará en unos minutos. El centro de carga más cercano es Eastside Library, en [ADDRESS], abierto hasta las 9 de la noche.',
    help: 'Gracias. Una persona del condado le llamará para ayudarle.',
    recheck: (h: number) => `Gracias. El centro de carga más cercano es Eastside Library, en [ADDRESS], abierto hasta las 9 de la noche. Le volveré a llamar en unas ${h} horas.`,
  },
  hi: {
    intro: "नमस्ते [NAME], मैं CareLine बोल रही हूँ, आपकी county emergency services की तरफ़ से एक automated wellness check। आपके इलाके में बिजली गई हुई है। मैं तीन छोटे सवाल पूछूँगी। किसी इंसान से बात करने के लिए कभी भी 'person' बोलें, या कॉल बंद करवाने के लिए 'stop' बोलें।",
    q1: 'क्या आप अभी सुरक्षित हैं?',
    q2: 'क्या आपकी medical device में बिजली है, वह battery पर चल रही है, या बंद है?',
    q3: 'आपकी battery लगभग कितने घंटे और चलेगी?',
    q4: 'क्या आपको दवा, खाना, transport, या device चार्ज करने की जगह चाहिए?',
    emergency: 'अगर यह emergency है, तो अभी फ़ोन रखकर 911 डायल करें। मैं आपको एक responder से जोड़ रही हूँ।',
    urgent: 'धन्यवाद। county का एक responder कुछ ही मिनटों में आपको कॉल करेगा।',
    help: 'धन्यवाद। county की टीम आज ही आपसे संपर्क करेगी।',
    recheck: (h: number) => `धन्यवाद। सबसे पास का charging center Eastside Library है, [ADDRESS] पर, रात 9 बजे तक खुला। मैं लगभग ${h} घंटे में फिर से कॉल करूँगी।`,
  },
}

type Line = Exclude<keyof (typeof LINES)['en'], 'recheck'>

/** Builds a transcript: CareLine's fixed lines interleaved with the resident's replies. */
function convo(lang: Language, steps: Array<Line | [Line, string] | string>): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [{ speaker: 'careline', text: LINES[lang].intro }]
  for (const step of steps) {
    if (Array.isArray(step)) {
      turns.push({ speaker: 'careline', text: LINES[lang][step[0]] }, { speaker: 'resident', text: step[1] })
    } else if (step in LINES[lang]) {
      turns.push({ speaker: 'careline', text: LINES[lang][step as Line] })
    } else {
      turns.push({ speaker: 'careline', text: step })
    }
  }
  return turns
}

function checkin(lang: Language, fields: Partial<CheckIn>): CheckIn {
  return {
    is_safe: 'yes', device_has_power: 'yes', battery_hours: null, needs: ['none'],
    distress_signals: ['none'], language_detected: lang, confidence: 0.92, ...fields,
  }
}

// ---- Call scripts. Times are demo-clock minutes after the outage starts. ----

export interface AttemptScript {
  kind: CallKind
  dialAt: number
  answered: boolean
  /** Minutes from dialing to hang-up (or to the no-answer timeout). */
  duration: number
  turns?: TranscriptTurn[]
  extracted?: CheckIn
  triage?: Triage
  rule_id?: string
  tasks?: Array<{ type: TaskType; priority: 1 | 2 | 3 | 4; need?: string }>
  /** Minutes after hang-up until the next scheduled check-in. */
  nextCheckIn?: number
}

const noAnswer = (kind: CallKind, dialAt: number, tasks?: AttemptScript['tasks']): AttemptScript =>
  ({ kind, dialAt, answered: false, duration: 3, tasks })

export const SCRIPTS: Record<string, AttemptScript[]> = {
  'R-102': [{
    kind: 'INITIAL', dialAt: 2, answered: true, duration: 2,
    turns: convo('hi', [['q1', 'मुझे साँस लेने में दिक्कत हो रही है... machine बंद हो गई है।'], 'emergency']),
    extracted: checkin('hi', { is_safe: 'no', device_has_power: 'no', distress_signals: ['breathing_difficulty'], confidence: 0.93 }),
    triage: 'URGENT', rule_id: 'R0', tasks: [{ type: 'OPERATOR_ALERT', priority: 1 }],
  }],
  'R-114': [{
    kind: 'INITIAL', dialAt: 6, answered: true, duration: 2.5,
    turns: convo('es', [
      ['q1', 'Sí, estoy bien, gracias.'],
      ['q2', 'Está con la batería desde que se fue la luz.'],
      ['q3', 'Como tres horas, creo.'],
      ['q4', 'Un lugar para cargarlo, sí. Mi hijo me puede llevar.'],
      'urgent',
    ]),
    extracted: checkin('es', { device_has_power: 'on_battery', battery_hours: 3, needs: ['charging'], confidence: 0.94 }),
    triage: 'URGENT', rule_id: 'R2',
    tasks: [{ type: 'OPERATOR_ALERT', priority: 1 }, { type: 'CHARGING', priority: 1, need: 'charging' }],
  }],
  'R-120': [noAnswer('INITIAL', 10), noAnswer('RETRY', 23, [{ type: 'WELFARE_CHECK', priority: 1 }])],
  'R-131': [{
    kind: 'INITIAL', dialAt: 14, answered: true, duration: 2.5,
    turns: convo('en', [
      ['q1', "Yeah, I'm alright."],
      ['q2', "It's on the battery pack since the lights went out."],
      ['q3', 'The little screen says two hours fifty-five minutes.'],
      ['q4', "I'd need a ride somewhere to charge it. I don't drive anymore."],
      'urgent',
    ]),
    extracted: checkin('en', { device_has_power: 'on_battery', battery_hours: 2.92, needs: ['transport', 'charging'], confidence: 0.96 }),
    triage: 'URGENT', rule_id: 'R2',
    tasks: [{ type: 'OPERATOR_ALERT', priority: 1 }, { type: 'TRANSPORT', priority: 1, need: 'transport' }],
  }],
  'R-108': [{
    kind: 'INITIAL', dialAt: 18, answered: true, duration: 3,
    turns: convo('es', [
      ['q1', 'Pues... mi nieta vino ayer, no sé. ¿Quién habla?'],
      ['q2', 'La máquina... no sé si está prendida, hace un ruido.'],
      ['q3', 'No sé, no sé.'],
      ['q4', 'Mi nieta sabe de eso.'],
      'help',
    ]),
    extracted: checkin('es', { is_safe: 'unsure', device_has_power: 'unsure', confidence: 0.48 }),
    triage: 'HUMAN_REVIEW', rule_id: 'R4', tasks: [{ type: 'HUMAN_REVIEW', priority: 1 }],
  }],
  'R-125': [{
    kind: 'INITIAL', dialAt: 22, answered: true, duration: 2.5,
    turns: convo('en', [
      ['q1', "I'm okay."],
      ['q2', "No, it's off. The fridge stopped when the power went."],
      ['q4', "My medicine has to stay cold, and I don't have a car."],
      'help',
    ]),
    extracted: checkin('en', { device_has_power: 'no', needs: ['medicine', 'transport'], confidence: 0.9 }),
    triage: 'NEEDS_HELP', rule_id: 'R5',
    tasks: [{ type: 'MEDICINE', priority: 2, need: 'medicine' }, { type: 'TRANSPORT', priority: 2, need: 'transport' }],
    nextCheckIn: 240,
  }],
  'R-137': [
    {
      kind: 'INITIAL', dialAt: 26, answered: true, duration: 2.5,
      turns: convo('en', [
        ['q1', "Yes, I'm fine."],
        ['q2', "It's running on the backup battery."],
        ['q3', 'Six hours. The unit says six.'],
        ['q4', "No, I'm good for now."],
        LINES.en.recheck(3),
      ]),
      extracted: checkin('en', { device_has_power: 'on_battery', battery_hours: 6, confidence: 0.95 }),
      triage: 'SAFE', rule_id: 'R7', nextCheckIn: 180,
    },
    {
      // Battery-runway recheck at half the remaining hours (plan, "Battery runway").
      kind: 'RECHECK', dialAt: 208.5, answered: true, duration: 2.5,
      turns: convo('en', [
        ['q1', "I'm okay, but it's going faster than I thought."],
        ['q2', 'Still on the battery.'],
        ['q3', 'Two and a half hours now.'],
        ['q4', 'I think I need somewhere to charge it.'],
        'urgent',
      ]),
      extracted: checkin('en', { device_has_power: 'on_battery', battery_hours: 2.5, needs: ['charging'], confidence: 0.94 }),
      triage: 'URGENT', rule_id: 'R2',
      tasks: [{ type: 'OPERATOR_ALERT', priority: 1 }, { type: 'CHARGING', priority: 1, need: 'charging' }],
    },
  ],
  'R-142': [{
    kind: 'INITIAL', dialAt: 30, answered: true, duration: 2.5,
    turns: convo('hi', [
      ['q1', 'हाँ, मैं ठीक हूँ।'],
      ['q2', 'wheelchair पूरी चार्ज है।'],
      ['q4', 'खाना ख़त्म हो रहा है, fridge बंद है।'],
      'help',
    ]),
    extracted: checkin('hi', { needs: ['food'], confidence: 0.91 }),
    triage: 'NEEDS_HELP', rule_id: 'R6', tasks: [{ type: 'FOOD', priority: 3, need: 'food' }], nextCheckIn: 240,
  }],
  'R-149': [{
    kind: 'INITIAL', dialAt: 34, answered: true, duration: 2,
    turns: convo('en', [
      ['q1', "I'm good."],
      ['q2', "The chair's fully charged."],
      ['q4', "No, I'm all set, thanks."],
      LINES.en.recheck(4),
    ]),
    extracted: checkin('en', { confidence: 0.97 }),
    triage: 'SAFE', rule_id: 'R7', nextCheckIn: 240,
  }],
  'R-153': [
    noAnswer('INITIAL', 38),
    {
      kind: 'RETRY', dialAt: 51, answered: true, duration: 2,
      turns: convo('es', [
        ['q1', 'Sí, todo bien.'],
        ['q2', 'El scooter tiene carga.'],
        ['q4', 'No, nada, gracias.'],
        LINES.es.recheck(4),
      ]),
      extracted: checkin('es', { confidence: 0.95 }),
      triage: 'SAFE', rule_id: 'R7', nextCheckIn: 240,
    },
  ],
}
