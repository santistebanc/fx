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

export function StopsFilterBar({ label, min, max, value, onChange, hideLabel }: StopsFilterBarProps) {
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
      <div className="stops-option-bar natural-breaks-option-bar" role="group" aria-label={label}>
        <span className="filter-threshold-label" aria-hidden="true">max</span>
        {options.map((n) => {
          const isFilled = active >= n
          const isSelected = active === n
          return (
            <button
              key={n}
              type="button"
              aria-pressed={isSelected}
              className={
                "stops-option-btn natural-breaks-option-btn" +
                (isFilled ? " stops-option-btn--filled" : "") +
                (isSelected ? " stops-option-btn--active" : "")
              }
              onClick={() => onChange(n)}
            >
              <span className="stops-option-btn__sizer">{n}</span>
              <span className="stops-option-btn__label">{n}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
