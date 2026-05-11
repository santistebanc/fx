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
  hideLabel?: boolean
}

export function StatSlider({ label, value, min, max, step, format, onChange, tripValue, hideLabel }: StatSliderProps) {
  const range = max - min
  const clamp = (v: number) => Math.min(Math.max(v, min), max)
  const knobValue = clamp(value)
  const safeStep = step > 0 ? step : 1
  const knobRef = useRef<HTMLDivElement>(null)

  const startKnobDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const track = event.currentTarget.closest(".stat-track")
    if (!(track instanceof HTMLElement)) return

    const pointerId = event.pointerId
    const target = event.currentTarget

    const updateFromClientX = (clientX: number) => {
      const rect = track.getBoundingClientRect()
      if (rect.width <= 0) return
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const rawValue = min + pct * range
      const nextValue = clamp(Math.round(rawValue / safeStep) * safeStep)
      onChange(nextValue >= max - safeStep ? max : nextValue)
    }

    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
      window.removeEventListener("pointercancel", handleUp)
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      if (knobRef.current) knobRef.current.style.transition = ""
    }

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      const rect = track.getBoundingClientRect()
      if (rect.width <= 0) return
      const pct = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width))
      if (knobRef.current) knobRef.current.style.setProperty("--knob-pos", `${pct * 100}%`)
      updateFromClientX(moveEvent.clientX)
    }

    const handleUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      cleanup()
    }

    event.preventDefault()
    if (knobRef.current) knobRef.current.style.transition = "none"
    target.setPointerCapture(pointerId)
    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    window.addEventListener("pointercancel", handleUp)
  }

  const handleKnobKey = (e: KeyboardEvent<HTMLDivElement>) => {
    let delta = 0
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") delta = -safeStep
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") delta = safeStep
    else if (e.key === "Home") { onChange(min); return }
    else if (e.key === "End") { onChange(max); return }
    else return
    e.preventDefault()
    onChange(clamp(knobValue + delta))
  }

  let fillLeftPct = 0
  let fillWidthPct = 100

  if (range > 0) {
    const vSel = knobValue
    if (tripValue != null) {
      const vTrip = clamp(tripValue)
      const low = Math.min(vTrip, vSel)
      const high = Math.max(vTrip, vSel)
      fillLeftPct = ((low - min) / range) * 100
      fillWidthPct = ((high - low) / range) * 100
    } else {
      fillWidthPct = ((vSel - min) / range) * 100
    }
  }

  const knobPct = range > 0 ? ((knobValue - min) / range) * 100 : 100

  return (
    <div className="stat-row">
      {!hideLabel && (
        <div className="stat-head">
          <span className="stat-name">{label}</span>
        </div>
      )}
      <div className="stat-bar-wrap">
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
              className="stat-hatch"
              style={{ '--hatch-left': `${knobPct}%` } as CSSProperties}
            />
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
              onChange(raw >= max - safeStep ? max : raw)
            }}
            aria-hidden="true"
          />
        </div>
        <div className="stat-bounds-wrap">
          <div
            className="stat-slider-bounds"
            aria-hidden="true"
          >
            <span className="stat-bound-min">{format(min)}</span>
            <span className="stat-bound-value">{format(knobValue)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
