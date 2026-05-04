type StopsFilterBarProps = {
  label: string
  min: number
  max: number
  value: number
  onChange: (v: number) => void
  tripValue?: number | null
  /** When set, the label row is omitted (e.g. label shown elsewhere). */
  hideLabel?: boolean
}

export function StopsFilterBar({ label, min, max, value, onChange, tripValue, hideLabel }: StopsFilterBarProps) {
  const options: number[] = []
  for (let n = min; n <= max; n++) options.push(n)

  const active = Math.min(Math.max(value, min), max)

  return (
    <div className="stat-row">
      {!hideLabel && (
        <div className="stat-head">
          <span className="stat-name">{label}</span>
        </div>
      )}
      <div className="stops-option-bar" role="group" aria-label={label}>
        {options.map((n) => {
          const isSelected = active === n
          const isTrip = tripValue != null && tripValue === n
          return (
            <button
              key={n}
              type="button"
              className={
                "stops-option-btn" +
                (isSelected ? " stops-option-btn--active" : "") +
                (isTrip ? " stops-option-btn--trip" : "")
              }
              onClick={() => onChange(n)}
            >
              {n}
            </button>
          )
        })}
      </div>
    </div>
  )
}
