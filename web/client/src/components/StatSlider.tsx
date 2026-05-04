type StatSliderProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  tripValue?: number | null
}

export function StatSlider({ label, value, min, max, step, format, onChange, tripValue }: StatSliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 100
  const tripPct =
    tripValue != null && max > min
      ? Math.min(100, Math.max(0, ((tripValue - min) / (max - min)) * 100))
      : null

  return (
    <div className="stat-row">
      <div className="stat-head">
        <span className="stat-name">{label}</span>
      </div>
      <div className="stat-bar-wrap">
        <div className="stat-track">
          <div className="stat-fill" style={{ width: `${pct}%` }} />
          {tripPct != null && (
            <div className="stat-trip-marker" style={{ left: `${tripPct}%` }} />
          )}
        </div>
        <input
          type="range"
          className="stat-range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
        />
      </div>
      <div className="stat-bounds">
        <span>{format(min)}</span>
        {tripPct != null && tripValue != null && (
          <span className="stat-trip-val">{format(tripValue)}</span>
        )}
        <span>{format(max)}</span>
      </div>
    </div>
  )
}
