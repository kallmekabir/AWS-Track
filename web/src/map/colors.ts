// One source for level colors: the map canvas reads these directly and
// applyColorTokens() copies them into CSS custom properties for the rest of the page.
// Checked with the dataviz palette validator (all pairs, on white): every hue pair clears
// CVD dE 8 except Help soon / OK for now, so "OK for now" pins are drawn small and
// "A person must check" is a diamond. No blue cleared both teal and purple, so
// "Calling now" is an ink ring rather than a fourth cool hue.
// Red is used for "Help now" only (CLAUDE.md section 3).
import type { Status } from '../api'

export const INK = '#14202C'

export const LEVEL_COLORS: Record<Status, string> = {
  HELP_NOW: '#B3212E',
  HELP_SOON: '#E0A21A',
  PERSON_CHECK: '#7048C0',
  NEEDS_SUPPLIES: '#0A84A3',
  OK_FOR_NOW: '#5FA83A',
  CALLING: INK,
  NOT_CALLED: '#98A1AA',
}

/** Ink for rank numbers drawn on each pin: white where it holds contrast, dark ink elsewhere. */
export const ON_LEVEL: Record<Status, string> = {
  HELP_NOW: '#FFFFFF',
  HELP_SOON: INK,
  PERSON_CHECK: '#FFFFFF',
  NEEDS_SUPPLIES: '#FFFFFF',
  OK_FOR_NOW: INK,
  CALLING: INK,
  NOT_CALLED: INK,
}

const TOKEN: Record<Status, string> = {
  HELP_NOW: 'now',
  HELP_SOON: 'soon',
  PERSON_CHECK: 'check',
  NEEDS_SUPPLIES: 'supplies',
  OK_FOR_NOW: 'ok',
  CALLING: 'calling',
  NOT_CALLED: 'waiting',
}

export function levelToken(status: Status): string {
  return TOKEN[status]
}

export function applyColorTokens(root: HTMLElement = document.documentElement) {
  for (const status of Object.keys(LEVEL_COLORS) as Status[]) {
    root.style.setProperty(`--lvl-${TOKEN[status]}`, LEVEL_COLORS[status])
  }
}
