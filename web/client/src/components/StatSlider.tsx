type StatSliderProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  tripValue?: number | null
  /** When set, the label row is omitted (e.g. label shown elsewhere). */
  hideLabel?: boolean
}

export function StatSlider({ label, value, min, max, step, format, onChange, tripValue, hideLabel }: StatSliderProps) {
  const range = max - min
  const clamp = (v: number) => Math.min(Math.max(v, min), max)
  const knobValue = clamp(value)
  const safeStep = step > 0 ? step : 1

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
  const hatchWidthPct = 100 - knobPct

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
                left: `${fillLeftPct}%`,
                width: `${fillWidthPct}%`,
              }}
            />
            <div
              className="stat-hatch"
              style={{
                left: `${knobPct}%`,
                width: `${hatchWidthPct}%`,
              }}
            />
            <div
              className="stat-knob"
              style={{ left: `${knobPct}%` }}
            />
          </div>
          <input
            type="range"
            className="stat-range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={e => {
              const raw = Number(e.target.value)
              // Range inputs cannot emit `max` if step doesn't divide (max - min).
              // Snap near the right edge so users can always reach the hard limit.
              onChange(raw >= max - safeStep ? max : raw)
            }}
            aria-label={hideLabel ? label : undefined}
          />
        </div>
        <div className="stat-bounds-wrap">
          <div
            className="stat-slider-bounds"
            aria-label={`${format(min)} to ${format(knobValue)}`}
          >
            <span className="stat-bound-min">{format(min)}</span>
            <span className="stat-bound-sep"> - </span>
            <span className="stat-bound-value">{format(knobValue)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
