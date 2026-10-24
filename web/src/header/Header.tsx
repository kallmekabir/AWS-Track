// W02: outage identity, the demo clock beside real time, counters, start and end,
// and the zone strip with Brief me. The header turns ink while an outage is active.
import { useState } from 'react'
import { api, ApiError } from '../api/client'
import type { OutageMeta, OutageSummary } from '../api/types'
import { config, ZONES } from '../config'
import { clock, span } from '../lib/time'
import { useNow } from '../lib/useNow'
import { Glyph } from '../ui/Glyph'
import './Header.css'

interface Props {
  outage: OutageMeta | null
  summary: OutageSummary | null
  simNow: number | null
  loading: boolean
  apiError: Error | null
  mapUnavailable: boolean
  onOutageChanged: () => void
  onBrief: () => void
}

export function Header({ outage, summary, simNow, loading, apiError, mapUnavailable, onOutageChanged, onBrief }: Props) {
  const now = useNow(1000)
  const active = outage?.status === 'ACTIVE'

  return (
    <header className={`hdr${active ? ' hdr--active' : ''}`}>
      <div className="hdr-main">
        <div className="brand">
          <span className="brand-name">CareLine</span>
          <span className="brand-org">Santa Clara County Public Health</span>
        </div>

        {active && outage ? (
          <>
            <div className="hdr-outage">
              <h1 className="hdr-outage-name">
                Outage in {outage.zone_id}, {outage.zone_name}
              </h1>
              <p className="hdr-outage-meta">
                Started {clock(outage.started_at)}
                {simNow !== null && <>, {span((simNow - Date.parse(outage.started_at)) / 60000)} ago on the demo clock</>}
              </p>
            </div>

            <div className="hdr-clock">
              <span className="hdr-clock-time num" aria-label="Demo clock">
                {simNow === null ? '--:--' : clock(simNow)}
              </span>
              <span className="hdr-clock-caption">
                Demo clock, {outage.time_scale}× speed
                <br />
                Real time <span className="num">{clock(now)}</span>
              </span>
            </div>

            <Counters summary={summary} />
          </>
        ) : (
          <IdleStart loading={loading} apiError={apiError} onStarted={onOutageChanged} now={now} />
        )}

        <div className="hdr-flags">
          {config.useMocks && <span className="hdr-flag">Mock data</span>}
          {mapUnavailable && <span className="hdr-flag hdr-flag--warn">Map unavailable</span>}
          {active && outage && <EndOutage outage={outage} onEnded={onOutageChanged} />}
        </div>
      </div>

      {active && outage && <ZoneStrip outage={outage} summary={summary} onBrief={onBrief} />}
    </header>
  )
}

function Counters({ summary }: { summary: OutageSummary | null }) {
  const t = summary?.totals
  const v = (n: number | undefined) => (n === undefined ? '–' : n)
  return (
    <dl className="hdr-counts">
      <div>
        <dt>Called</dt>
        <dd className="num">
          {v(t?.called)}
          <span className="hdr-count-of"> of {v(t?.residents)}</span>
        </dd>
      </div>
      <div>
        <dt>Reached</dt>
        <dd className="num">{v(t?.reached)}</dd>
      </div>
      <div>
        <dt>
          <Glyph group="URGENT" /> Urgent
        </dt>
        <dd className="num">{v(t?.urgent)}</dd>
      </div>
      <div>
        <dt>
          <Glyph group="UNREACHED" /> Unreached
        </dt>
        <dd className="num">{v(t?.unreached)}</dd>
      </div>
    </dl>
  )
}

function IdleStart({ loading, apiError, onStarted, now }: { loading: boolean; apiError: Error | null; onStarted: () => void; now: number }) {
  const [zoneId, setZoneId] = useState('Z2')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.startOutage(zoneId)
      onStarted()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The outage did not start. Check the API connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hdr-idle">
      <div className="hdr-idle-text">
        <h1 className="hdr-outage-name">{loading ? 'Connecting' : 'No active outage'}</h1>
        <p className="hdr-outage-meta">
          {apiError
            ? `Can't reach the CareLine API: ${apiError.message}`
            : 'Starting one calls every registered resident in the zone, highest medical risk first.'}
        </p>
      </div>
      <form
        className="hdr-start"
        onSubmit={(e) => {
          e.preventDefault()
          start()
        }}
      >
        <label className="sr-only" htmlFor="zone-pick">
          Zone
        </label>
        <select id="zone-pick" className="hdr-select" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
          {ZONES.map((z) => (
            <option key={z.zone_id} value={z.zone_id}>
              {z.zone_id} {z.zone_name}
            </option>
          ))}
        </select>
        <button className="btn" type="submit" disabled={busy || loading}>
          {busy ? 'Starting outage' : 'Start outage'}
        </button>
      </form>
      {error && <p className="hdr-error" role="alert">{error}</p>}
      <p className="hdr-idle-clock">
        Real time <span className="num">{clock(now)}</span>
      </p>
    </div>
  )
}

function EndOutage({ outage, onEnded }: { outage: OutageMeta; onEnded: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!confirming) {
    return (
      <button className="btn btn--on-dark" onClick={() => setConfirming(true)}>
        End outage
      </button>
    )
  }
  return (
    <div className="hdr-confirm" role="group" aria-label="Confirm end outage">
      <span>Stops every pending call and recheck in {outage.zone_name}.</span>
      <button
        className="btn btn--light"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await api.endOutage(outage.outage_id)
            onEnded()
          } finally {
            setBusy(false)
            setConfirming(false)
          }
        }}
      >
        End outage
      </button>
      <button className="btn btn--on-dark" onClick={() => setConfirming(false)}>
        Keep running
      </button>
    </div>
  )
}

function ZoneStrip({ outage, summary, onBrief }: { outage: OutageMeta; summary: OutageSummary | null; onBrief: () => void }) {
  return (
    <nav className="zones" aria-label="Zones">
      <ul className="zones-list">
        {ZONES.map((z) => {
          const zs = summary?.zones.find((x) => x.zone_id === z.zone_id)
          const isOutage = z.zone_id === outage.zone_id
          return (
            <li key={z.zone_id} className={`zone${isOutage ? ' zone--active' : ''}`} aria-current={isOutage ? 'true' : undefined}>
              <span className="zone-id">{z.zone_id}</span>
              <span className="zone-name">{z.zone_name}</span>
              {isOutage && zs ? (
                <span className="zone-stats">
                  <span className="num">{zs.pct_contacted}% reached</span>
                  <span className="zone-flag num" title={`${zs.urgent} urgent`}>
                    <Glyph group="URGENT" /> {zs.urgent}
                  </span>
                  <span className="zone-flag num" title={`${zs.unreached} unreached`}>
                    <Glyph group="UNREACHED" /> {zs.unreached}
                  </span>
                </span>
              ) : (
                <span className="zone-none">{isOutage ? 'Loading' : 'No outage'}</span>
              )}
            </li>
          )
        })}
      </ul>
      <button className="btn btn--light" onClick={onBrief}>
        Brief me on {outage.zone_id}
      </button>
    </nav>
  )
}
