import { useState } from "react"

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function isoToLocal(iso: string | null): Date | null {
  if (!iso) return null
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function localToIso(d: Date | null): string {
  if (!d) return ""
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function sameDay(a: Date | null, b: Date | null): boolean {
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function between(d: Date, a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false
  const t = d.getTime(), lo = Math.min(a.getTime(), b.getTime()), hi = Math.max(a.getTime(), b.getTime())
  return t > lo && t < hi
}

function buildMonth(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const startDow = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  return cells
}

type CalendarMonthProps = {
  year: number
  month: number
  start: Date | null
  end: Date | null
  hovered: Date | null
  today: Date
  onHover: (d: Date | null) => void
  onPick: (d: Date) => void
  isRound: boolean
}

function CalendarMonth({ year, month, start, end, hovered, today, onHover, onPick, isRound }: CalendarMonthProps) {
  const cells = buildMonth(year, month)
  const rows: (Date | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))

  return (
    <div className="cal-month">
      <div className="cal-month-title">{MONTHS[month]} {year}</div>
      <div className="cal-grid">
        {DAYS.map(d => <div key={d} className="cal-dow">{d}</div>)}
        {rows.map((row, ri) =>
          row.map((day, di) => {
            if (!day) return <div key={`e-${ri}-${di}`} className="cal-cell cal-cell--empty" />
            const isPast = day < today
            const isStart = sameDay(day, start)
            const isEnd = isRound && sameDay(day, end)
            const isHov = isRound && !end && sameDay(day, hovered)
            const inRange = isRound && (
              (start && end && between(day, start, end)) ||
              (start && !end && hovered && between(day, start, hovered))
            )
            let cls = "cal-cell"
            if (isPast) cls += " cal-cell--past"
            if (isStart) cls += " cal-cell--start"
            if (isEnd) cls += " cal-cell--end"
            if (isHov) cls += " cal-cell--hovered"
            if (inRange) cls += " cal-cell--in-range"
            if (sameDay(day, today)) cls += " cal-cell--today"

            return (
              <div
                key={`d-${ri}-${di}`}
                className={cls}
                onMouseEnter={() => !isPast && onHover(day)}
                onMouseLeave={() => onHover(null)}
                onClick={() => !isPast && onPick(day)}
              >
                {day.getDate()}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

type DateModalProps = {
  depDate: string
  retDate: string
  roundTrip: boolean
  onApply: (result: { dep: string; ret: string; isRound: boolean }) => void
  onClose: () => void
}

export function DateModal({ depDate, retDate, roundTrip, onApply, onClose }: DateModalProps) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const [isRound, setIsRound] = useState(roundTrip)
  const [start, setStart] = useState<Date | null>(isoToLocal(depDate))
  const [end, setEnd] = useState<Date | null>(isoToLocal(retDate))
  const [hovered, setHovered] = useState<Date | null>(null)
  const [picking, setPicking] = useState<"start" | "end">("start")

  const base = start || today
  const [viewYear, setViewYear] = useState(base.getFullYear())
  const [viewMonth, setViewMonth] = useState(base.getMonth())

  const m2 = viewMonth === 11 ? 0 : viewMonth + 1
  const y2 = viewMonth === 11 ? viewYear + 1 : viewYear

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  function onPick(day: Date) {
    if (!isRound) { setStart(day); setEnd(null); setPicking("start"); return }
    if (picking === "start" || (end != null && day <= (start ?? day))) {
      setStart(day); setEnd(null); setPicking("end")
    } else {
      if (start && day < start) { setStart(day); setEnd(null); setPicking("end") }
      else { setEnd(day); setPicking("start") }
    }
  }

  function toggleRound() {
    setIsRound(r => { if (r) setEnd(null); return !r })
    setPicking("start")
  }

  const fmtDisplay = (d: Date | null) =>
    d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"

  const canApply = start != null && (!isRound || end != null)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="date-modal-box date-modal-box--cal" onClick={e => e.stopPropagation()}>
        <div className="date-modal-header">
          <span className="date-modal-title">Travel Dates</span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <label className="round-trip-toggle">
              <button
                className={`toggle-track${isRound ? " on" : ""}`}
                onClick={toggleRound}
                type="button"
                aria-pressed={isRound}
              >
                <span className="toggle-knob" />
              </button>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--ink)" }}>Round trip</span>
            </label>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="cal-range-display">
          <div
            className={`cal-range-pill${picking === "start" ? " cal-range-pill--active" : ""}`}
            onClick={() => setPicking("start")}
          >
            <span className="cal-range-pill-label">Depart</span>
            <span className="cal-range-pill-val">{fmtDisplay(start)}</span>
          </div>
          {isRound && (
            <>
              <span className="cal-range-arrow">→</span>
              <div
                className={`cal-range-pill${picking === "end" ? " cal-range-pill--active" : ""}`}
                onClick={() => setPicking("end")}
              >
                <span className="cal-range-pill-label">Return</span>
                <span className="cal-range-pill-val">{fmtDisplay(end)}</span>
              </div>
            </>
          )}
        </div>

        <div className="cal-nav">
          <button className="cal-nav-btn" onClick={prevMonth}>‹</button>
          <div className="cal-months-row">
            <CalendarMonth
              year={viewYear} month={viewMonth}
              start={start} end={end} hovered={hovered} today={today}
              onHover={setHovered} onPick={onPick} isRound={isRound}
            />
            <CalendarMonth
              year={y2} month={m2}
              start={start} end={end} hovered={hovered} today={today}
              onHover={setHovered} onPick={onPick} isRound={isRound}
            />
          </div>
          <button className="cal-nav-btn" onClick={nextMonth}>›</button>
        </div>

        <div className="date-modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-apply"
            disabled={!canApply}
            style={{ opacity: canApply ? 1 : 0.45, cursor: canApply ? "pointer" : "not-allowed" }}
            onClick={() => canApply && onApply({ dep: localToIso(start), ret: localToIso(end), isRound })}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
