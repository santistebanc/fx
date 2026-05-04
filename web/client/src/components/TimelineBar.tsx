import { useState } from "react"
import type { UiFlight } from "../lib/transformApiResponse"

const SEG_COLORS = ["var(--seg0)", "var(--seg1)", "var(--seg2)", "var(--seg3)"]

function fmtDur(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

type Seg = { type: "flight"; index: number; leftPct: number; widthPct: number; flight: UiFlight }

function buildTimelineSegs(flights: UiFlight[]): { segs: Seg[]; totalMin: number } {
  const totalMin = flights.reduce((acc, fl, i) =>
    acc + fl.dur + (i < flights.length - 1 && fl.conn ? fl.conn : 0), 0)

  const segs: Seg[] = []
  let cursor = 0
  flights.forEach((fl, i) => {
    const leftPct = (cursor / totalMin) * 100
    const widthPct = (fl.dur / totalMin) * 100
    segs.push({ type: "flight", index: i, leftPct, widthPct, flight: fl })
    cursor += fl.dur
    if (i < flights.length - 1 && fl.conn && fl.conn > 0) {
      cursor += fl.conn
    }
  })
  return { segs, totalMin }
}

type Boundary = { pct: number; time: string; isFirst: boolean; isLast: boolean; which: "dep" | "arr" }

export function TimelineBar({ flights, showLegs = true }: { flights: UiFlight[]; showLegs?: boolean }) {
  const { segs, totalMin } = buildTimelineSegs(flights)
  const [legsExpanded, setLegsExpanded] = useState(false)

  const boundaries: Boundary[] = []
  let cursor = 0
  flights.forEach((fl, i) => {
    const depPct = (cursor / totalMin) * 100
    boundaries.push({ pct: depPct, time: fl.dep, isFirst: i === 0, isLast: false, which: "dep" })
    cursor += fl.dur
    const arrPct = (cursor / totalMin) * 100
    boundaries.push({ pct: arrPct, time: fl.arr, isFirst: false, isLast: i === flights.length - 1, which: "arr" })
    if (i < flights.length - 1 && fl.conn) cursor += fl.conn
  })

  const aboveTimes = boundaries.filter(b => b.which === "dep")
  const belowTimes = boundaries.filter(b => b.which === "arr")

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div className="timeline-wrap">
        <div className="timeline-times-above">
          {aboveTimes.map((b, i) => (
            <span
              key={i}
              className={`t-time${b.isFirst ? " t-time--first" : ""}`}
              style={{ left: `${b.pct}%` }}
            >
              {b.time}
            </span>
          ))}
        </div>

        <div className="timeline-track-wrap">
          <div className="timeline-track">
            {boundaries.map((b, i) => (
              <div key={`tick-${i}`} className="t-tick" style={{ left: `${b.pct}%` }} />
            ))}
            {segs.map((seg, i) => {
              const fl = seg.flight
              const isLastFlight = seg.index === flights.length - 1
              return (
                <div
                  key={`fl-${i}`}
                  className={`t-seg t-seg--${seg.index % SEG_COLORS.length}`}
                  style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }}
                  title={`${fl.from}→${fl.to}  ${fl.dep}–${fl.arr}  ${fmtDur(fl.dur)}`}
                >
                  <span className="t-seg-iata t-seg-iata--left">{fl.from}</span>
                  {isLastFlight && <span className="t-seg-iata t-seg-iata--right">{fl.to}</span>}
                </div>
              )
            })}
          </div>
        </div>

        <div className="timeline-times-below">
          {belowTimes.map((b, i) => (
            <span
              key={i}
              className={`t-time${b.isLast ? " t-time--last" : ""}`}
              style={{ left: `${b.pct}%` }}
            >
              {b.time}
            </span>
          ))}
        </div>
      </div>

      {showLegs && (
        <>
          <button
            type="button"
            className="legs-toggle"
            onClick={() => setLegsExpanded((v) => !v)}
            aria-expanded={legsExpanded}
          >
            {legsExpanded ? "Hide leg details" : "Show leg details"}
          </button>
          {legsExpanded && (
            <div className="leg-list">
              {flights.map((fl, i) => (
                <div key={`leg-wrap-${i}`}>
                  <div className="leg-item">
                    <span className="leg-color-dot" style={{ background: SEG_COLORS[i % SEG_COLORS.length] }} />
                    <span className="leg-route">{fl.from} → {fl.to}</span>
                    <span className="leg-time">{fl.dep} – {fl.arr}</span>
                    <span className="leg-airline">{fl.airline} · {fl.fn}</span>
                    <span className="leg-duration">{fmtDur(fl.dur)}</span>
                  </div>
                  {fl.conn != null && fl.conn > 0 && i < flights.length - 1 && (
                    <div className="layover-row">
                      <span className="layover-dot" />
                      Layover at {fl.to} · {fmtDur(fl.conn)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
