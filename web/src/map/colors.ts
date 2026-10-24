// One source for state colors: the map canvas reads these directly and
// applyColorTokens() copies them into CSS custom properties for the rest of the page.
// Validated with the dataviz palette checker (all pairs, on white): every pair clears
// CVD dE 8 except review/safe, which is why review pins are diamonds and safe pins are small.
import type { TriageGroup } from '../api/types'

export const INK = '#14202C'
export const NAVY = '#1D3A72'

export const TRIAGE_COLORS: Record<TriageGroup, string> = {
  URGENT: '#B3212E',
  HUMAN_REVIEW: '#E0A21A',
  UNREACHED: '#7048C0',
  NEEDS_HELP: '#0A84A3',
  PENDING: '#98A1AA',
  SAFE: '#5FA83A',
}

/** Ink for numbers drawn on each fill: white where it holds contrast, dark ink elsewhere. */
export const ON_TRIAGE: Record<TriageGroup, string> = {
  URGENT: '#FFFFFF',
  HUMAN_REVIEW: INK,
  UNREACHED: TRIAGE_COLORS.UNREACHED,
  NEEDS_HELP: '#FFFFFF',
  PENDING: INK,
  SAFE: INK,
}

const TOKEN: Record<TriageGroup, string> = {
  URGENT: 'urgent',
  HUMAN_REVIEW: 'review',
  UNREACHED: 'unreached',
  NEEDS_HELP: 'help',
  PENDING: 'pending',
  SAFE: 'safe',
}

export function triageToken(group: TriageGroup): string {
  return TOKEN[group]
}

export function applyColorTokens(root: HTMLElement = document.documentElement) {
  for (const group of Object.keys(TRIAGE_COLORS) as TriageGroup[]) {
    root.style.setProperty(`--triage-${TOKEN[group]}`, TRIAGE_COLORS[group])
  }
  root.style.setProperty('--navy', NAVY)
}
