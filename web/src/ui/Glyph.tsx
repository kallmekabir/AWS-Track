// The same shape per triage group everywhere (list, legend, map pins), so state never
// rests on color alone: review is a diamond, unreached is an open ring.
import type { TriageGroup } from '../api/types'
import { NAVY, TRIAGE_COLORS } from '../map/colors'

export function Glyph({ group, size = 10 }: { group: TriageGroup; size?: number }) {
  const c = TRIAGE_COLORS[group]
  const h = size / 2
  return (
    <svg className="glyph" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {group === 'HUMAN_REVIEW' ? (
        <path d={`M${h} 0 L${size} ${h} L${h} ${size} L0 ${h} Z`} fill={c} />
      ) : group === 'UNREACHED' ? (
        <circle cx={h} cy={h} r={h - 1.25} fill="none" stroke={c} strokeWidth={2.5} />
      ) : (
        <circle cx={h} cy={h} r={group === 'SAFE' || group === 'PENDING' ? h * 0.8 : h} fill={c} />
      )}
    </svg>
  )
}

export function HospitalGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <rect width="12" height="12" rx="2" fill={NAVY} />
      <path d="M3.5 2.8v6.4M8.5 2.8v6.4M3.5 6h5" stroke="#fff" strokeWidth="1.6" />
    </svg>
  )
}
