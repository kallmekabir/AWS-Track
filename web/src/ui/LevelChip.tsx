import type { Status } from '../api'
import { levelToken } from '../map/colors'
import { LEVEL_LABEL, RULE_TEXT } from '../lib/levels'
import { Glyph } from './Glyph'
import './LevelChip.css'

/** A level in plain words, with its shape and, when ranked, the rule ID. */
export function LevelChip({ status, rule }: { status: Status; rule?: string | null }) {
  return (
    <span className={`lchip lchip--${levelToken(status)}`}>
      {status === 'CALLING' ? <span className="lchip-pulse" aria-hidden="true" /> : <Glyph status={status} />}
      <span className="lchip-label">{LEVEL_LABEL[status]}</span>
      {rule ? (
        <abbr className="lchip-rule" title={RULE_TEXT[rule] ?? rule}>
          {rule}
        </abbr>
      ) : null}
    </span>
  )
}
