import { useState } from "react"
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react"
import type { UiFlight } from "../lib/transformApiResponse"
import type { AirportInfo } from "../lib/airportInfo"

const KNOB_STEP_MS = 5 * 60 * 1000 // 5 min

function fmtMs(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
}

type KnobFilter = { value: number; onChange: (v: number) => void }

function fmtDur(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

type Seg = { type: "flight"; index: number; leftPct: number; widthPct: number; flight: UiFlight }
type SegLabel = { key: string; pct: number; code: string; side: "left" | "right"; intermediate: boolean; endpoint: boolean; origin: boolean }
type SpanLabel = { key: string; kind: "layover"; leftPct: number; widthPct: number; text: string; airportCode: string }

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

function snapToStep(value: number, step: number): number {
  return Math.round(value / step) * step
}


export function TimelineBar({
  flights,
  showLegs = true,
  range,
  airlineColors,
  depKnob,
  arrKnob,
  airportInfo = {},
}: {
  flights: UiFlight[]
  showLegs?: boolean
  range?: TimelineRange
  airlineColors?: Record<string, string>
  depKnob?: KnobFilter
  arrKnob?: KnobFilter
  airportInfo?: Record<string, AirportInfo>
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
  const [zoomLevel, setZoomLevel] = useState(1)
  const ZOOM_STEPS = [1, 1.5, 2, 3, 4]
  const zoomIdx = ZOOM_STEPS.indexOf(zoomLevel) === -1 ? 0 : ZOOM_STEPS.indexOf(zoomLevel)
  const canZoomIn = zoomIdx < ZOOM_STEPS.length - 1
  const canZoomOut = zoomIdx > 0

  const boundaries: Boundary[] = []
  flights.forEach((fl, i) => {
    const depPct = ((fl.depAt - timelineRange.start) / 60000 / totalMin) * 100
    boundaries.push({ pct: depPct, time: fl.dep, isFirst: i === 0, isLast: false, which: "dep" })
    const arrPct = ((fl.arrAt - timelineRange.start) / 60000 / totalMin) * 100
    boundaries.push({ pct: arrPct, time: fl.arr.replace(/\+\d+$/, ""), isFirst: false, isLast: i === flights.length - 1, which: "arr" })
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

  const spanLabels: SpanLabel[] = flights.flatMap((fl, i) => {
      if (i >= flights.length - 1) return []
      const next = flights[i + 1]
      if (!next) return []
      const leftPct = ((fl.arrAt - timelineRange.start) / 60000 / totalMin) * 100
      const widthPct = ((next.depAt - fl.arrAt) / 60000 / totalMin) * 100
      const text = fmtDur(Math.max(0, Math.round((next.depAt - fl.arrAt) / 60000)))
      return [{
        key: `layover-dur-${i}`,
        kind: "layover" as const,
        leftPct,
        widthPct,
        text,
        airportCode: fl.to,
      }]
    })

  const aboveTimes = boundaries.filter(b => b.which === "dep")
  const belowTimes = boundaries.filter(b => b.which === "arr")
  const airlineColor = (airline: string) => airlineColors?.[airline] ?? "var(--seg0)"

  const startKnobDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    which: "dep" | "arr",
  ) => {
    if (!depKnob || !arrKnob) return

    const track = event.currentTarget.closest(".timeline-track")
    if (!(track instanceof HTMLElement)) return

    const pointerId = event.pointerId
    const target = event.currentTarget
    const totalMs = timelineRange.end - timelineRange.start

    const updateFromClientX = (clientX: number) => {
      const rect = track.getBoundingClientRect()
      if (rect.width <= 0) return

      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const rawValue = timelineRange.start + pct * totalMs
      const nextValue = snapToStep(rawValue, KNOB_STEP_MS)

      if (which === "dep") depKnob.onChange(Math.min(nextValue, arrKnob.value - KNOB_STEP_MS))
      else arrKnob.onChange(Math.max(nextValue, depKnob.value + KNOB_STEP_MS))
    }

    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
      window.removeEventListener("pointercancel", handleUp)
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
    }

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      updateFromClientX(moveEvent.clientX)
    }

    const handleUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      cleanup()
    }

    event.preventDefault()
    target.setPointerCapture(pointerId)
    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    window.addEventListener("pointercancel", handleUp)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, width: "100%" }}>
      <div className={`timeline-wrap${zoomLevel > 1 ? " timeline-wrap--zoomed" : ""}`}>
        <div className="timeline-scroll-shell">
          <div className="timeline-scroll-inner" style={zoomLevel > 1 ? { width: `${zoomLevel * 100}%` } : undefined}>
            <div className="timeline-track-wrap">
              <div className="timeline-hour-labels">
                {hourLabels.map((l, i) => (
                  <span key={`hlabel-${i}`} className="t-hour-label" style={{ left: `${l.pct}%` }}>
                    {l.label}
                  </span>
                ))}
              </div>
              <div className="timeline-flight-labels timeline-flight-labels--top">
                {aboveTimes.map((b, i) => (
                  <span
                    key={`dep-${i}`}
                    className={`t-time${b.isFirst ? " t-time--first" : ""}`}
                    style={{ '--t-pos': `${b.pct}%` } as CSSProperties}
                  >
                    {b.time}
                  </span>
                ))}
              </div>
              <div className="timeline-flight-labels timeline-flight-labels--bottom">
                {belowTimes.map((b, i) => (
                  <span
                    key={`arr-${i}`}
                    className={`t-time${b.isLast ? " t-time--last" : ""}`}
                    style={{ '--t-pos': `${b.pct}%` } as CSSProperties}
                  >
                    {b.time}
                  </span>
                ))}
              </div>
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
                      <div
                        className="t-filter-knob"
                        style={{ left: `${depPct}%` }}
                        onPointerDown={(event) => startKnobDrag(event, "dep")}
                      >
                        <span className="t-filter-label t-filter-label--below">{fmtMs(depKnob.value)}</span>
                      </div>
                      <div
                        className="t-filter-knob"
                        style={{ left: `${arrPct}%` }}
                        onPointerDown={(event) => startKnobDrag(event, "arr")}
                      >
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
                {spanLabels.map((label) => {
                  const info = airportInfo[label.airportCode]
                  const loc = info ? `${info.city}, ${info.country}` : null
                  return (
                    <span
                      key={label.key}
                      className={`t-span-label t-span-label--${label.kind}`}
                      style={{ left: `${label.leftPct}%`, width: `${label.widthPct}%` }}
                      title={`${label.text} layover · ${label.airportCode}${loc ? ` · ${loc}` : ""}`}
                    >
                      <span>{label.text}</span>
                    </span>
                  )
                })}
                {segLabels.map((label) => {
                  const info = airportInfo[label.code]
                  const loc = info ? `${info.city}, ${info.country}` : null
                  return (
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
                      title={loc ? `${label.code} · ${loc}` : label.code}
                    >
                      {label.code}
                    </span>
                  )
                })}
                {segs.map((seg) => {
                  const fl = seg.flight
                  return (
                    <div
                      key={`fl-${seg.index}`}
                      className="t-seg"
                      style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%`, background: airlineColor(fl.airline) }}
                      title={`${fl.from}→${fl.to}  ${fl.dep}–${fl.arr}  ${fmtDur(fl.dur)}  ·  ${fl.airline} ${fl.fn}`}
                    >
                      <span className="t-span-label t-span-label--flight t-span-label--in-seg">
                        <span>{fmtDur(fl.dur)}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="timeline-actions">
        {showLegs && (
          <button
            type="button"
            className="legs-toggle"
            onClick={() => setLegsExpanded((v) => !v)}
            aria-expanded={legsExpanded}
          >
            {legsExpanded ? "Hide leg details" : "Show leg details"}
          </button>
        )}
        <div className="timeline-zoom-btns">
          <button
            type="button"
            className="timeline-zoom-toggle"
            disabled={!canZoomOut}
            aria-label="Zoom out timeline"
            title="Zoom out"
            onClick={() => setZoomLevel(ZOOM_STEPS[zoomIdx - 1]!)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="timeline-zoom-icon">
              <path d="M3 8h10" />
            </svg>
          </button>
          <button
            type="button"
            className="timeline-zoom-toggle"
            disabled={!canZoomIn}
            aria-label="Zoom in timeline"
            title="Zoom in"
            onClick={() => setZoomLevel(ZOOM_STEPS[zoomIdx + 1]!)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="timeline-zoom-icon">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        </div>
      </div>

      {showLegs && legsExpanded && (
        <div className="leg-list">
          {flights.map((fl, i) => {
            const fromInfo = airportInfo[fl.from]
            const toInfo = airportInfo[fl.to]
            const layoverInfo = airportInfo[fl.to]
            return (
              <div key={`leg-wrap-${i}`}>
                <div className="leg-item">
                  <span className="leg-color-dot" style={{ background: airlineColor(fl.airline) }} />
                  <span className="leg-route">
                    {fl.from}{fromInfo ? <span className="leg-city"> · {fromInfo.city}</span> : ""}{" → "}{fl.to}{toInfo ? <span className="leg-city"> · {toInfo.city}</span> : ""}
                  </span>
                  <span className="leg-time">{fl.dep} – {fl.arr}</span>
                  <span className="leg-airline">{fl.airline} · {fl.fn}</span>
                  <span className="leg-duration">{fmtDur(fl.dur)}</span>
                </div>
                {fl.conn != null && fl.conn > 0 && i < flights.length - 1 && (
                  <div
                    className="layover-row"
                    title={layoverInfo ? `${fl.to} · ${layoverInfo.city}, ${layoverInfo.country}` : fl.to}
                  >
                    <span className="layover-dot" />
                    Layover at {fl.to}{layoverInfo ? <span className="leg-city"> · {layoverInfo.city}</span> : ""} · {fmtDur(fl.conn)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
