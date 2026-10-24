import type { TriageGroup } from '../api/types'
import { triageToken } from '../map/colors'
import { GROUP_LABEL, RULE_TEXT } from '../lib/triage'
import { Glyph } from './Glyph'
import './TriageChip.css'

export function TriageChip({ group, rule }: { group: TriageGroup; rule?: string | null }) {
  return (
    <span className={`tchip tchip--${triageToken(group)}`}>
      <Glyph group={group} />
      <span className="tchip-label">{GROUP_LABEL[group]}</span>
      {rule ? (
        <abbr className="tchip-rule" title={RULE_TEXT[rule] ?? rule}>
          {rule === 'OVERRIDE' ? 'Override' : rule}
        </abbr>
      ) : null}
    </span>
  )
}
