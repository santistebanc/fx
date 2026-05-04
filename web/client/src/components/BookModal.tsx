import type { UiTrip } from "../lib/transformApiResponse"

function fmtPrice(price: number, currency = "EUR"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price)
}

export function BookModal({ trip, onClose }: { trip: UiTrip; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            Book · {trip.deals.length} offer{trip.deals.length !== 1 ? "s" : ""}
          </span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {trip.deals.map((d, i) => (
            <a key={i} href={d.link} className="deal-row" target="_blank" rel="noreferrer">
              <span className="deal-row-prov">{d.provider}</span>
              <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span className="deal-row-price">{fmtPrice(d.price, trip.currency)}</span>
                <span className="deal-row-arrow">→</span>
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
