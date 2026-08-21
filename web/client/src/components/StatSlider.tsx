import { useRef } from "react"
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react"

type StatSliderProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  tripValue?: number | null
  noAdditionFrom?: number | null
  noAdditionUntil?: number | null
  hasCurrentResults?: boolean
  snapPoints?: number[]
  hideLabel?: boolean
}

export function StatSlider({ label, value, min, max, step, format, onChange, tripValue, noAdditionFrom, noAdditionUntil, hasCurrentResults = true, snapPoints, hideLabel }: StatSliderProps) {
  const range = max - min
  const clamp = (v: number) => Math.min(Math.max(v, min), max)
  const safeStep = step > 0 ? step : 1
  const cleanSnapPoints = snapPoints
    ? Array.from(new Set([min, ...snapPoints, max].filter(Number.isFinite).map(clamp))).sort((a, b) => a - b)
    : []
  const snapToPoint = (v: number) => {
    if (cleanSnapPoints.length === 0) return clamp(v)
    return cleanSnapPoints.reduce((best, point) => (
      Math.abs(point - v) < Math.abs(best - v) ? point : best
    ), cleanSnapPoints[0]!)
  }
  const snapIndexForValue = (v: number) => {
    if (cleanSnapPoints.length === 0) return -1
    const snapped = snapToPoint(v)
    return Math.max(0, cleanSnapPoints.findIndex(point => point === snapped))
  }
  const snapPctForIndex = (index: number) => {
    if (cleanSnapPoints.length <= 1) return 100
    return 100 - (index / (cleanSnapPoints.length - 1)) * 100
  }
  const valuePct = (v: number) => {
    if (cleanSnapPoints.length > 0) return snapPctForIndex(snapIndexForValue(v))
    return range > 0 ? 100 - ((clamp(v) - min) / range) * 100 : 100
  }
  const continuousValuePct = (v: number) => (
    range > 0 ? 100 - ((clamp(v) - min) / range) * 100 : 100
  )
  const valueFromTrackPct = (pct: number) => {
    if (cleanSnapPoints.length > 0) {
      const index = Math.max(0, Math.min(cleanSnapPoints.length - 1, Math.round((1 - pct) * (cleanSnapPoints.length - 1))))
      return cleanSnapPoints[index]!
    }
    const rawValue = max - pct * range
    return clamp(Math.round(rawValue / safeStep) * safeStep)
  }
  const commitValue = (nextValue: number) => {
    onChange(cleanSnapPoints.length > 0 ? nextValue : nextValue >= max - safeStep ? max : nextValue)
  }
  const knobValue = snapToPoint(value)
  const knobRef = useRef<HTMLDivElement>(null)

  const startKnobDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const track = event.currentTarget.closest(".stat-track")
    if (!(track instanceof HTMLElement)) return

    const pointerId = event.pointerId
    const target = event.currentTarget

    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
      window.removeEventListener("pointercancel", handleUp)
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      document.documentElement.classList.remove("is-stat-slider-dragging")
    }

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      const rect = track.getBoundingClientRect()
      if (rect.width <= 0) return
      const pct = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width))
      const nextValue = valueFromTrackPct(pct)
      if (knobRef.current) knobRef.current.style.setProperty("--knob-pos", `${valuePct(nextValue)}%`)
      commitValue(nextValue)
    }

    const handleUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      cleanup()
    }

    event.preventDefault()
    document.documentElement.classList.add("is-stat-slider-dragging")
    target.setPointerCapture(pointerId)
    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    window.addEventListener("pointercancel", handleUp)
  }

  const handleKnobKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (cleanSnapPoints.length > 0) {
      const currentIndex = cleanSnapPoints.findIndex(point => point === knobValue)
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault()
        onChange(cleanSnapPoints[Math.min(cleanSnapPoints.length - 1, currentIndex + 1)] ?? max)
        return
      }
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault()
        onChange(cleanSnapPoints[Math.max(0, currentIndex - 1)] ?? min)
        return
      }
      if (e.key === "Home") { onChange(max); return }
      if (e.key === "End") { onChange(min); return }
    }

    let delta = 0
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") delta = safeStep
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") delta = -safeStep
    else if (e.key === "Home") { onChange(max); return }
    else if (e.key === "End") { onChange(min); return }
    else return
    e.preventDefault()
    onChange(clamp(knobValue + delta))
  }

  let fillLeftPct = 0
  const knobPct = valuePct(knobValue)
  let fillWidthPct = knobPct

  const noAdditionStartValue = noAdditionFrom == null ? knobValue : clamp(noAdditionFrom)
  const noAdditionEndValue = noAdditionUntil == null ? noAdditionStartValue : clamp(noAdditionUntil)
  const noAdditionStartPct = Math.min(valuePct(noAdditionStartValue), valuePct(noAdditionEndValue))
  const noAdditionEndPct = Math.max(valuePct(noAdditionStartValue), valuePct(noAdditionEndValue))
  const tripValuePct = tripValue == null ? null : continuousValuePct(tripValue)

  return (
    <div className="stat-row">
      {!hideLabel && (
        <div className="stat-head">
          <span className="stat-name">{label}</span>
        </div>
      )}
      <div className="stat-bar-wrap">
        <div className="stat-track-row">
          <div className="stat-track-shell">
            <div className="stat-track">
              <div
                className="stat-fill"
                style={{
                  '--fill-left': `${fillLeftPct}%`,
                  '--fill-right': `${fillLeftPct + fillWidthPct}%`,
                } as CSSProperties}
              />
              <div
                className="stat-no-addition-fill"
                style={{
                  '--no-addition-left': `${noAdditionStartPct}%`,
                  '--no-addition-right': `${noAdditionEndPct}%`,
                } as CSSProperties}
              />
              <div
                className="stat-hatch"
                style={{ '--hatch-left': `${knobPct}%` } as CSSProperties}
              />
              {tripValuePct != null && (
                <div
                  className="stat-trip-value-fill"
                  style={{ '--trip-value-right': `${tripValuePct}%` } as CSSProperties}
                />
              )}
              <div
                ref={knobRef}
                role="slider"
                tabIndex={0}
                aria-label={label}
                aria-valuenow={knobValue}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuetext={format(knobValue)}
                className="stat-knob"
                style={{ '--knob-pos': `${knobPct}%` } as CSSProperties}
                onPointerDown={startKnobDrag}
                onKeyDown={handleKnobKey}
              />
            </div>
            <input
              type="range"
              tabIndex={-1}
              className="stat-range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={e => {
                const raw = Number(e.target.value)
                const nextValue = valueFromTrackPct(range > 0 ? (max - raw) / range : 0)
                commitValue(nextValue)
              }}
              aria-hidden="true"
            />
          </div>
          <span className="stat-bound-min" aria-hidden="true">{format(min)}</span>
        </div>
        <div className="stat-bounds-wrap stat-bounds-wrap--bottom">
          <div
            className="stat-slider-bounds stat-slider-bounds--bottom"
            style={{ '--bound-value-pos': `${knobPct}%` } as CSSProperties}
            aria-hidden="true"
          >
            <span className="stat-bound-value">max {format(knobValue)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
