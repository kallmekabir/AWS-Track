// The same shape per level everywhere (list, legend, map pins), so a level never rests
// on color alone: "A person must check" is a diamond, "Calling now" is an open ring.
import type { Status } from '../api'
import { LEVEL_COLORS } from '../map/colors'

export function Glyph({ status, size = 10 }: { status: Status; size?: number }) {
  const c = LEVEL_COLORS[status]
  const h = size / 2
  return (
    <svg className="glyph" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {status === 'PERSON_CHECK' ? (
        <path d={`M${h} 0 L${size} ${h} L${h} ${size} L0 ${h} Z`} fill={c} />
      ) : status === 'CALLING' ? (
        <circle cx={h} cy={h} r={h - 1.25} fill="none" stroke={c} strokeWidth={2.5} />
      ) : (
        <circle cx={h} cy={h} r={status === 'OK_FOR_NOW' || status === 'NOT_CALLED' ? h * 0.8 : h} fill={c} />
      )}
    </svg>
  )
}
