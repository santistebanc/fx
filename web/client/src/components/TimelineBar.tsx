import { useState } from "react"
import type { UiFlight } from "../lib/transformApiResponse"

const KNOB_STEP_MS = 5 * 60 * 1000 // 5 min

function fmtMs(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
}

type KnobFilter = { value: number; onChange: (v: number) => void }

const SEG_COLORS = ["var(--seg0)", "var(--seg1)", "var(--seg2)", "var(--seg3)"]

function fmtDur(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

type Seg = { type: "flight"; index: number; leftPct: number; widthPct: number; flight: UiFlight }
type SegLabel = { key: string; pct: number; code: string; side: "left" | "right"; intermediate: boolean; endpoint: boolean; origin: boolean }

type TimelineRange = { start: number; end: number }

type HourMark = { pct: number; isMidnight: boolean; isQuarter: boolean }

// Ticks at local clock-hour boundaries within any span (flights or gaps).
// depAt/arrAt store local times as UTC, so UTC hour boundaries = local clock hours.
function buildSpanHourMarks(spanStart: number, spanEnd: number, range: TimelineRange): HourMark[] {
  const MS_PER_HOUR = 3_600_000
  const totalMs = range.end - range.start
  const marks: HourMark[] = []
  const firstHour = Math.ceil(spanStart / MS_PER_HOUR) * MS_PER_HOUR
  for (let ts = firstHour; ts < spanEnd; ts += MS_PER_HOUR) {
    const h = new Date(ts).getUTCHours()
    marks.push({
      pct: ((ts - range.start) / totalMs) * 100,
      isMidnight: h === 0,
      isQuarter: h === 6 || h === 12 || h === 18,
    })
  }
  return marks
}

function buildTimelineSegs(flights: UiFlight[], range: TimelineRange): { segs: Seg[]; totalMin: number } {
  const totalMin = Math.max(1, (range.end - range.start) / 60000)

  const segs: Seg[] = []
  flights.forEach((fl, i) => {
    const leftPct = ((fl.depAt - range.start) / 60000 / totalMin) * 100
    const widthPct = ((fl.arrAt - fl.depAt) / 60000 / totalMin) * 100
    segs.push({ type: "flight", index: i, leftPct, widthPct, flight: fl })
  })
  return { segs, totalMin }
}

type Boundary = { pct: number; time: string; isFirst: boolean; isLast: boolean; which: "dep" | "arr" }

export function TimelineBar({
  flights,
  showLegs = true,
  range,
  depKnob,
  arrKnob,
}: {
  flights: UiFlight[]
  showLegs?: boolean
  range?: TimelineRange
  depKnob?: KnobFilter
  arrKnob?: KnobFilter
}) {
  const fallbackRange = flights.length > 0
    ? { start: flights[0].depAt, end: flights[flights.length - 1].arrAt }
    : { start: 0, end: 1 }
  const timelineRange = range ?? fallbackRange
  const { segs, totalMin } = buildTimelineSegs(flights, timelineRange)
  const hourMarks = [
    ...(flights.length > 0 ? buildSpanHourMarks(timelineRange.start, flights[0]!.depAt, timelineRange) : []),
    ...flights.flatMap((fl, i) => [
      ...buildSpanHourMarks(fl.depAt, fl.arrAt, timelineRange),
      ...(i < flights.length - 1 ? buildSpanHourMarks(fl.arrAt, flights[i + 1]!.depAt, timelineRange) : []),
    ]),
    ...(flights.length > 0 ? buildSpanHourMarks(flights[flights.length - 1]!.arrAt, timelineRange.end, timelineRange) : []),
  ]
  const [legsExpanded, setLegsExpanded] = useState(false)

  const boundaries: Boundary[] = []
  flights.forEach((fl, i) => {
    const depPct = ((fl.depAt - timelineRange.start) / 60000 / totalMin) * 100
    boundaries.push({ pct: depPct, time: fl.dep, isFirst: i === 0, isLast: false, which: "dep" })
    const arrPct = ((fl.arrAt - timelineRange.start) / 60000 / totalMin) * 100
    boundaries.push({ pct: arrPct, time: fl.arr, isFirst: false, isLast: i === flights.length - 1, which: "arr" })
  })

  const hourLabels = (() => {
    const MS_PER_HOUR = 3_600_000
    const MS_PER_6H   = 6 * MS_PER_HOUR
    const totalMs = timelineRange.end - timelineRange.start
    const knobPcts = depKnob && arrKnob ? [
      Math.max(0, Math.min(100, ((depKnob.value - timelineRange.start) / totalMs) * 100)),
      Math.max(0, Math.min(100, ((arrKnob.value - timelineRange.start) / totalMs) * 100)),
    ] : []
    const [depKnobPct, arrKnobPct] = knobPcts
    const busyPcts = [...boundaries.map(b => b.pct), ...knobPcts]
    const THRESHOLD = 4 // pct — suppress label if a flight time is within this distance

    const seen = new Set<number>()
    const candidates: number[] = []
    const first6h = Math.ceil(timelineRange.start / MS_PER_6H) * MS_PER_6H
    for (let ts = first6h; ts <= timelineRange.end; ts += MS_PER_6H) candidates.push(ts)

    return candidates
      .filter(ts => { if (seen.has(ts)) return false; seen.add(ts); return true })
      .map(ts => ({
        pct: ((ts - timelineRange.start) / totalMs) * 100,
        label: `${String(new Date(ts).getUTCHours()).padStart(2, "0")}:00`,
      }))
      .filter(({ pct }) => {
        const inLeftEdgeBand = depKnobPct != null && pct <= depKnobPct
        const inRightEdgeBand = arrKnobPct != null && pct >= arrKnobPct
        if (inLeftEdgeBand || inRightEdgeBand) return false

        return (
        busyPcts.every(bp => Math.abs(bp - pct) >= THRESHOLD) &&
        flights.every(fl => {
          const flDepPct = ((fl.depAt - timelineRange.start) / totalMs) * 100
          const flArrPct = ((fl.arrAt - timelineRange.start) / totalMs) * 100
          return pct <= flDepPct || pct >= flArrPct
        })
        )
      })
  })()

  const segLabels: SegLabel[] = segs.flatMap((seg) => {
    const isFirstFlight = seg.index === 0
    const isIntermediate = seg.index < flights.length - 1
    return [
      ...(isFirstFlight ? [{
        key: `iata-left-${seg.index}`,
        pct: seg.leftPct,
        code: seg.flight.from,
        side: "left" as const,
        intermediate: false,
        endpoint: false,
        origin: true,
      }] : []),
      {
        key: `iata-right-${seg.index}`,
        pct: seg.leftPct + seg.widthPct,
        code: seg.flight.to,
        side: "right" as const,
        intermediate: isIntermediate,
        endpoint: !isIntermediate,
        origin: false,
      },
    ]
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
            {depKnob && arrKnob && (() => {
              const totalMs = timelineRange.end - timelineRange.start
              const depPct = Math.max(0, Math.min(100, ((depKnob.value - timelineRange.start) / totalMs) * 100))
              const arrPct = Math.max(0, Math.min(100, ((arrKnob.value - timelineRange.start) / totalMs) * 100))
              const depFront = depPct >= arrPct - 1
              return (
                <>
                  <div className="t-filter-shade t-filter-shade--left" style={{ width: `${depPct}%` }} />
                  <div className="t-filter-shade t-filter-shade--right" style={{ left: `${arrPct}%` }} />
                  <div className="t-filter-knob" style={{ left: `${depPct}%` }}>
                    <span className="t-filter-label t-filter-label--below">{fmtMs(depKnob.value)}</span>
                  </div>
                  <div className="t-filter-knob" style={{ left: `${arrPct}%` }}>
                    <span className="t-filter-label t-filter-label--above">{fmtMs(arrKnob.value)}</span>
                  </div>
                  <input
                    type="range"
                    className={`t-filter-range${depFront ? " t-filter-range--front" : ""}`}
                    min={timelineRange.start} max={timelineRange.end} step={KNOB_STEP_MS}
                    value={depKnob.value}
                    onChange={e => depKnob.onChange(Math.min(Number(e.target.value), arrKnob.value - KNOB_STEP_MS))}
                    aria-label="Departure time filter"
                  />
                  <input
                    type="range"
                    className={`t-filter-range${depFront ? "" : " t-filter-range--front"}`}
                    min={timelineRange.start} max={timelineRange.end} step={KNOB_STEP_MS}
                    value={arrKnob.value}
                    onChange={e => arrKnob.onChange(Math.max(Number(e.target.value), depKnob.value + KNOB_STEP_MS))}
                    aria-label="Arrival time filter"
                  />
                </>
              )
            })()}
            {hourMarks.map((m, i) => (
              <div
                key={`hr-${i}`}
                className={
                  m.isMidnight ? "t-hour-mark t-hour-mark--midnight"
                  : m.isQuarter ? "t-hour-mark t-hour-mark--quarter"
                  : "t-hour-mark"
                }
                style={{ left: `${m.pct}%` }}
              />
            ))}
            {hourLabels.map((l, i) => (
              <span key={`hlabel-${i}`} className="t-hour-label" style={{ left: `${l.pct}%` }}>
                {l.label}
              </span>
            ))}
            {segLabels.map((label) => (
              <span
                key={label.key}
                className={[
                  "t-seg-iata",
                  label.side === "left" ? "t-seg-iata--left" : "t-seg-iata--right",
                  label.intermediate ? "t-seg-iata--intermediate" : "",
                  label.endpoint ? "t-seg-iata--endpoint" : "",
                  label.origin ? "t-seg-iata--origin" : "",
                ].filter(Boolean).join(" ")}
                style={{ left: `${label.pct}%` }}
              >
                {label.code}
              </span>
            ))}
            {segs.map((seg) => {
              const fl = seg.flight
              return (
                <div
                  key={`fl-${seg.index}`}
                  className={`t-seg t-seg--${seg.index % SEG_COLORS.length}`}
                  style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }}
                  title={`${fl.from}→${fl.to}  ${fl.dep}–${fl.arr}  ${fmtDur(fl.dur)}`}
                >
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
