import { useState } from "react"

const ALL_SOURCES = ["Skyscanner", "Kiwi"]

type SourcesModalProps = {
  sources: string[]
  onApply: (selected: string[]) => void
  onClose: () => void
}

export function SourcesModal({ sources, onApply, onClose }: SourcesModalProps) {
  const [selected, setSelected] = useState<string[]>([...sources])

  function toggle(src: string) {
    setSelected(s => s.includes(src) ? s.filter(x => x !== src) : [...s, src])
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ width: "min(100%, 20rem)" }}>
        <div className="modal-header">
          <span className="modal-title">Data Sources</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ padding: "0.5rem 0" }}>
          {ALL_SOURCES.map(src => {
            const on = selected.includes(src)
            return (
              <div key={src} className="sources-option" onClick={() => toggle(src)}>
                <div className={`sources-check${on ? " sources-check--on" : ""}`}>
                  {on && <span>✓</span>}
                </div>
                <span className="sources-option-label">{src}</span>
              </div>
            )
          })}
        </div>
        <div className="date-modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-apply"
            disabled={selected.length === 0}
            style={{ opacity: selected.length ? 1 : 0.45, cursor: selected.length ? "pointer" : "not-allowed" }}
            onClick={() => onApply(selected)}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
