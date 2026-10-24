// Operator-facing words for every code the API returns. Rule wording follows the
// triage table in README.md; keep them in step with lambdas/triage/rules.py.
import type { CallKind, CallStatus, CheckIn, Language, TaskType, Triage, TriageGroup } from '../api/types'

export const GROUP_LABEL: Record<TriageGroup, string> = {
  URGENT: 'Urgent',
  HUMAN_REVIEW: 'Review',
  UNREACHED: 'Unreached',
  NEEDS_HELP: 'Needs help',
  PENDING: 'Pending',
  SAFE: 'Safe',
}

export const GROUP_ORDER: TriageGroup[] = ['URGENT', 'HUMAN_REVIEW', 'UNREACHED', 'NEEDS_HELP', 'PENDING', 'SAFE']

export const TRIAGE_OPTIONS: Triage[] = ['URGENT', 'HUMAN_REVIEW', 'NEEDS_HELP', 'SAFE']

export const RULE_TEXT: Record<string, string> = {
  R0: 'Emergency or a distress signal on the call',
  R1: 'Device has no power, risk tier 1',
  R2: 'On battery with under 4 hours left, or battery unknown at tier 1',
  R3: 'Resident says they are not safe',
  R4: 'Unclear answer or low confidence at tier 1 or 2',
  R5: 'Needs medicine, transport or charging',
  R6: 'Needs food only',
  R7: 'No risk found, recheck scheduled',
  OVERRIDE: 'Set by an operator',
}

/** The extracted fields each rule reads, highlighted beside the transcript. */
export function fieldsForRule(rule: string | null, extracted: CheckIn | null): Array<keyof CheckIn> {
  switch (rule) {
    case 'R0':
      return ['distress_signals']
    case 'R1':
      return ['device_has_power']
    case 'R2':
      return ['device_has_power', 'battery_hours']
    case 'R3':
      return ['is_safe']
    case 'R4': {
      const unsure = (Object.keys(extracted ?? {}) as Array<keyof CheckIn>).filter((k) => extracted?.[k] === 'unsure')
      return ['confidence', ...unsure]
    }
    case 'R5':
    case 'R6':
      return ['needs']
    default:
      return []
  }
}

export const TASK_LABEL: Record<TaskType, string> = {
  OPERATOR_ALERT: 'Urgent alert',
  HUMAN_REVIEW: 'Call back to review',
  WELFARE_CHECK: 'Welfare check',
  TRANSPORT: 'Transport',
  CHARGING: 'Charging',
  MEDICINE: 'Medicine',
  FOOD: 'Food',
  INFO_SMS: 'Info text',
}

export const KIND_LABEL: Record<CallKind, string> = {
  INITIAL: 'First call',
  RETRY: 'Retry',
  RECHECK: 'Recheck',
}

export const STATUS_LABEL: Record<CallStatus, string> = {
  QUEUED: 'Queued',
  RINGING: 'Ringing',
  ANSWERED: 'Answered',
  NO_ANSWER: 'No answer',
  NO_RESPONSE: 'No response',
  PARTIAL: 'Hung up',
  FAILED: 'Failed',
  OPTED_OUT: 'Opted out',
}

export const LANGUAGE_LABEL: Record<Language, string> = {
  en: 'English',
  es: 'Spanish',
  hi: 'Hindi',
}
