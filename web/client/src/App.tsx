import { useState } from "react"
import { SearchChrome } from "./components/SearchChrome"
import { Sidebar, type Filters } from "./components/Sidebar"
import { TimelineBar } from "./components/TimelineBar"
import { BookModal } from "./components/BookModal"
import { transformApiResponse, type ApiPayload, type UiTrip } from "./lib/transformApiResponse"

function fmtPrice(price: number, currency = "EUR"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price)
}

function fmtDur(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function filterTrips(trips: UiTrip[], filters: Filters): UiTrip[] {
  return trips.filter(t =>
    t.price <= filters.price &&
    t.stats.duration <= filters.duration &&
    t.stats.stops <= filters.stops &&
    t.stats.layover <= filters.layover,
  )
}

function defaultFilters(trips: UiTrip[]): Filters {
  if (trips.length === 0) return { price: 9999999, duration: 9999, stops: 99, layover: 9999 }
  return {
    price: Math.max(...trips.map(t => t.price)),
    duration: Math.max(...trips.map(t => t.stats.duration)),
    stops: Math.max(...trips.map(t => t.stats.stops)),
    layover: Math.max(...trips.map(t => t.stats.layover)),
  }
}

type Status = "idle" | "loading" | "error"

export function App() {
  const [allTrips, setAllTrips] = useState<UiTrip[]>([])
  const [filters, setFiltersState] = useState<Filters>({ price: 9999999, duration: 9999, stops: 99, layover: 9999 })
  const [idx, setIdx] = useState(0)
  const [animKey, setAnimKey] = useState(0)
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState("")
  const [bookOpen, setBookOpen] = useState(false)

  const setFilter = (key: keyof Filters, value: number) =>
    setFiltersState(f => ({ ...f, [key]: value }))

  function loadPayload(payload: ApiPayload) {
    const trips = transformApiResponse(payload)
    setAllTrips(trips)
    setFiltersState(defaultFilters(trips))
    setIdx(0)
    setAnimKey(k => k + 1)
    setStatus("idle")
  }

  async function onSearch(body: Record<string, unknown>) {
    setStatus("loading")
    setErrorMsg("")
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({})) as ApiPayload
      if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText)
      loadPayload(data)
    } catch (err) {
      setStatus("error")
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  async function onDemo(applyInput?: (inp: NonNullable<ApiPayload["input"]>) => void) {
    setStatus("loading")
    setErrorMsg("")
    try {
      const res = await fetch("/api/fixture-demo")
      const data = await res.json().catch(() => ({})) as ApiPayload
      if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText)
      if (data.input && applyInput) applyInput(data.input)
      loadPayload(data)
    } catch (err) {
      setStatus("error")
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  const visible = filterTrips(allTrips, filters)
  const trip = visible[idx] ?? null

  function navigate(dir: number) {
    setAnimKey(k => k + 1)
    setIdx(i => Math.max(0, Math.min(visible.length - 1, i + dir)))
  }

  return (
    <div className="app-shell">
      <SearchChrome onSearch={onSearch} onDemo={onDemo} busy={status === "loading"} />

      <div className="workspace">
        <Sidebar trips={allTrips} filters={filters} setFilter={setFilter} currentTrip={trip} />

        <main className="main-col">
          {status === "loading" && (
            <div className="empty-state">
              <div className="empty-icon" style={{ animationDuration: "1s" }}>✈</div>
              <p className="empty-text">Searching… live requests can take up to a minute.</p>
            </div>
          )}

          {status === "error" && (
            <div className="empty-state">
              <div className="empty-icon">⚠</div>
              <p className="empty-text">{errorMsg}</p>
            </div>
          )}

          {status === "idle" && allTrips.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">✈</div>
              <p className="empty-text">Run a search or load the demo snapshot to view trips.</p>
            </div>
          )}

          {status === "idle" && allTrips.length > 0 && (
            <>
              <div className="nav-row">
                <div className="nav-arrows">
                  <button className="arrow-btn" disabled={idx <= 0} onClick={() => navigate(-1)}>← Prev</button>
                  <button className="arrow-btn" disabled={idx >= visible.length - 1} onClick={() => navigate(1)}>Next →</button>
                </div>
                <span className="trip-counter">
                  {visible.length === 0 ? "No trips match filters" : `Trip ${idx + 1} of ${visible.length}`}
                </span>
                <div className="nav-spacer" />
                {trip && (
                  <button className="book-btn" onClick={() => setBookOpen(true)}>
                    Book ({trip.deals.length} offer{trip.deals.length !== 1 ? "s" : ""})
                  </button>
                )}
              </div>

              {trip ? (
                <div key={`trip-${trip.id}-${animKey}`} className="anim-in">
                  <div className="price-row anim-in">
                    <div className="trip-summary-chips">
                      <div className="trip-chip">
                        <span className="chip-label">Duration</span>
                        <span className="chip-val">{fmtDur(trip.stats.duration)}</span>
                      </div>
                      <div className="trip-chip">
                        <span className="chip-label">Total layover</span>
                        <span className="chip-val">{fmtDur(trip.stats.layover)}</span>
                      </div>
                    </div>
                    <div className="price-hero">{fmtPrice(trip.price, trip.currency)}</div>
                  </div>

                  <div className="itinerary-block anim-in anim-in-d2">
                    <div className="itin-header">
                      <span className="itin-direction">Outbound</span>
                      <span className="itin-date">{trip.outbound.date}</span>
                      <div className="itin-stats">
                        <span>Duration <span className="itin-stat-val">{fmtDur(trip.outbound.duration)}</span></span>
                        <span className="itin-stat-sep">·</span>
                        <span>Layover <span className="itin-stat-val">{fmtDur(trip.outbound.layover)}</span></span>
                      </div>
                    </div>
                    <TimelineBar flights={trip.outbound.flights} />
                  </div>

                  {trip.inbound && (
                    <div className="itinerary-block anim-in anim-in-d3">
                      <div className="itin-header">
                        <span className="itin-direction">Return</span>
                        <span className="itin-date">{trip.inbound.date}</span>
                        <div className="itin-stats">
                          <span>Duration <span className="itin-stat-val">{fmtDur(trip.inbound.duration)}</span></span>
                          <span className="itin-stat-sep">·</span>
                          <span>Layover <span className="itin-stat-val">{fmtDur(trip.inbound.layover)}</span></span>
                        </div>
                      </div>
                      <TimelineBar flights={trip.inbound.flights} />
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">✈</div>
                  <p className="empty-text">No trips match your current filters. Try relaxing the price, duration, or stop limits.</p>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {bookOpen && trip && <BookModal trip={trip} onClose={() => setBookOpen(false)} />}
    </div>
  )
}
