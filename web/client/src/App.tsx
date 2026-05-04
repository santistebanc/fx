import { useState } from "react"
import { SearchChrome } from "./components/SearchChrome"
import type { Filters } from "./components/Sidebar"
import { StatSlider } from "./components/StatSlider"
import { StopsFilterBar } from "./components/StopsFilterBar"
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

// For each stat, find the trip that is best (lowest) in that stat, then take
// the worst (highest) value of each stat across those four "best-in-class" trips.
// The resulting envelope is the smallest filter window that still includes
// every trip that is optimal in at least one dimension.
function computeCutoff(trips: UiTrip[]): Filters {
  if (trips.length === 0) return { price: 9999999, duration: 9999, stops: 99, layover: 9999 }
  const bestPrice    = trips.reduce((b, t) => t.price < b.price ? t : b)
  const bestDuration = trips.reduce((b, t) => t.stats.duration < b.stats.duration ? t : b)
  const bestLayover  = trips.reduce((b, t) => t.stats.layover  < b.stats.layover  ? t : b)
  const bestStops    = trips.reduce((b, t) => t.stats.stops    < b.stats.stops    ? t : b)
  const candidates   = [bestPrice, bestDuration, bestLayover, bestStops]
  return {
    price:    Math.max(...candidates.map(t => t.price)),
    duration: Math.max(...candidates.map(t => t.stats.duration)),
    stops:    Math.max(...candidates.map(t => t.stats.stops)),
    layover:  Math.max(...candidates.map(t => t.stats.layover)),
  }
}

type Status = "idle" | "loading" | "error"

export function App() {
  const [allTrips, setAllTrips] = useState<UiTrip[]>([])
  const [filters, setFiltersState] = useState<Filters>({ price: 9999999, duration: 9999, stops: 99, layover: 9999 })
  const [idx, setIdx] = useState(0)
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState("")
  const [bookOpen, setBookOpen] = useState(false)
  const [cutoffActive, setCutoffActive] = useState(true)

  const cutoff = allTrips.length > 0 ? computeCutoff(allTrips) : null

  const setFilter = (key: keyof Filters, value: number) =>
    setFiltersState(f => ({ ...f, [key]: value }))

  function toggleCutoff() {
    if (!cutoff) return
    if (cutoffActive) {
      setCutoffActive(false)
      setFiltersState({ price: absMaxPrice, duration: absMaxDur, stops: absMaxStops, layover: absMaxLay })
    } else {
      setCutoffActive(true)
      setFiltersState(cutoff)
    }
  }

  function loadPayload(payload: ApiPayload) {
    const trips = transformApiResponse(payload)
    const co = computeCutoff(trips)
    setAllTrips(trips)
    setFiltersState(co)
    setCutoffActive(true)
    setIdx(0)
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
  const noMatch = allTrips.length > 0 && visible.length === 0
  const clampedIdx = visible.length > 0 ? Math.min(idx, visible.length - 1) : 0
  const trip = visible[clampedIdx] ?? allTrips[0] ?? null

  const absMinDur   = allTrips.length > 0 ? Math.min(...allTrips.map(t => t.stats.duration)) : 0
  const absMaxDur   = allTrips.length > 0 ? Math.max(...allTrips.map(t => t.stats.duration)) : 0
  const absMinLay   = allTrips.length > 0 ? Math.min(...allTrips.map(t => t.stats.layover))  : 0
  const absMaxLay   = allTrips.length > 0 ? Math.max(...allTrips.map(t => t.stats.layover))  : 0
  const absMinStops = allTrips.length > 0 ? Math.min(...allTrips.map(t => t.stats.stops))    : 0
  const absMaxStops = allTrips.length > 0 ? Math.max(...allTrips.map(t => t.stats.stops))    : 0
  const absMinPrice = allTrips.length > 0 ? Math.min(...allTrips.map(t => t.price))          : 0
  const absMaxPrice = allTrips.length > 0 ? Math.max(...allTrips.map(t => t.price))          : 0

  const sliderMaxDur   = cutoffActive && cutoff ? cutoff.duration : absMaxDur
  const sliderMaxLay   = cutoffActive && cutoff ? cutoff.layover  : absMaxLay
  const sliderMaxStops = cutoffActive && cutoff ? cutoff.stops    : absMaxStops
  const sliderMaxPrice = cutoffActive && cutoff ? cutoff.price    : absMaxPrice

  const priceStep = Math.max(1, Math.round((absMaxPrice - absMinPrice) / 100))

  function navigate(dir: number) {
    setIdx(Math.max(0, Math.min(visible.length - 1, clampedIdx + dir)))
  }

  return (
    <div className="app-shell">
      <SearchChrome onSearch={onSearch} onDemo={onDemo} busy={status === "loading"} />

      <div className="workspace">
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
                  <button
                    type="button"
                    className="arrow-btn"
                    disabled={clampedIdx <= 0}
                    aria-label="Previous trip"
                    onClick={() => navigate(-1)}
                  >
                    <span className="arrow-btn-icon" aria-hidden="true">←</span>
                    <span className="arrow-btn-label">Prev</span>
                  </button>
                  <button
                    type="button"
                    className="arrow-btn"
                    disabled={clampedIdx >= visible.length - 1}
                    aria-label="Next trip"
                    onClick={() => navigate(1)}
                  >
                    <span className="arrow-btn-label">Next</span>
                    <span className="arrow-btn-icon" aria-hidden="true">→</span>
                  </button>
                </div>
                <span className="trip-counter">
                  {visible.length === 0 ? "No trips match filters" : `Trip ${clampedIdx + 1} of ${visible.length}`}
                </span>
                {cutoff && (
                  <button type="button" className="cutoff-toggle" onClick={toggleCutoff}>
                    {cutoffActive ? "use all data" : "use best data"}
                  </button>
                )}
                <div className="nav-spacer" />
                {!noMatch && trip && (
                  <button className="book-btn" onClick={() => setBookOpen(true)}>
                    Book
                  </button>
                )}
              </div>

              {trip && (
                <div>
                  <div className="price-row">
                    <div className="trip-stat-filters">
                      <div className="trip-stat-stack">
                        <div className={`trip-stat-hero-row${noMatch ? " no-match-dim" : ""}`}>
                          <span className="stat-name">Duration</span>
                          <span key={noMatch ? "—" : trip.stats.duration} className="trip-stat-hero-val anim-in">
                            {noMatch ? "—" : fmtDur(trip.stats.duration)}
                          </span>
                        </div>
                        <StatSlider
                          label="Duration"
                          hideLabel
                          value={filters.duration}
                          min={absMinDur}
                          max={sliderMaxDur}
                          step={30}
                          format={fmtDur}
                          onChange={v => setFilter("duration", v)}
                          tripValue={noMatch ? null : trip.stats.duration}
                        />
                      </div>
                      <div className="trip-stat-stack">
                        <div className={`trip-stat-hero-row${noMatch ? " no-match-dim" : ""}`}>
                          <span className="stat-name">Layover</span>
                          <span key={noMatch ? "—" : trip.stats.layover} className="trip-stat-hero-val anim-in">
                            {noMatch ? "—" : fmtDur(trip.stats.layover)}
                          </span>
                        </div>
                        <StatSlider
                          label="Layover"
                          hideLabel
                          value={filters.layover}
                          min={absMinLay}
                          max={sliderMaxLay}
                          step={15}
                          format={fmtDur}
                          onChange={v => setFilter("layover", v)}
                          tripValue={noMatch ? null : trip.stats.layover}
                        />
                      </div>
                      {absMinStops < sliderMaxStops && (
                        <div className="trip-stat-stack trip-stat-stack--stops">
                          <div className="trip-stat-hero-row">
                            <span className="stat-name">Stops</span>
                          </div>
                          <StopsFilterBar
                            label="Stops"
                            hideLabel
                            value={filters.stops}
                            min={absMinStops}
                            max={sliderMaxStops}
                            onChange={v => setFilter("stops", v)}
                            tripValue={noMatch ? null : trip.stats.stops}
                          />
                        </div>
                      )}
                    </div>
                    <div className="price-hero-stack">
                      <div className={`price-hero-row${noMatch ? " no-match-dim" : ""}`}>
                        <span className="stat-name">Price</span>
                        <div key={noMatch ? "—" : trip.price} className="price-hero anim-in">
                          {noMatch ? "—" : fmtPrice(trip.price, trip.currency)}
                        </div>
                      </div>
                      <StatSlider
                        label="Price"
                        hideLabel
                        value={filters.price}
                        min={absMinPrice}
                        max={sliderMaxPrice}
                        step={priceStep}
                        format={v => fmtPrice(v, trip.currency)}
                        onChange={v => setFilter("price", v)}
                        tripValue={noMatch ? null : trip.price}
                      />
                    </div>
                  </div>

                  <div className={`itinerary-block${noMatch ? " no-match-dim" : ""}`}>
                    <div className="itin-header">
                      <span className="itin-direction">Outbound</span>
                      <span key={noMatch ? "—" : trip.outbound.date} className="itin-date anim-in">
                        {noMatch ? "—" : trip.outbound.date}
                      </span>
                      <div className="itin-stats">
                        <span>Duration <span key={noMatch ? "—d" : trip.outbound.duration} className="itin-stat-val anim-in">{noMatch ? "—" : fmtDur(trip.outbound.duration)}</span></span>
                        <span className="itin-stat-sep">·</span>
                        <span>Layover <span key={noMatch ? "—l" : trip.outbound.layover} className="itin-stat-val anim-in">{noMatch ? "—" : fmtDur(trip.outbound.layover)}</span></span>
                      </div>
                    </div>
                    <TimelineBar key="outbound" flights={noMatch ? [] : trip.outbound.flights} />
                  </div>

                  {trip.inbound && (
                    <div className={`itinerary-block${noMatch ? " no-match-dim" : ""}`}>
                      <div className="itin-header">
                        <span className="itin-direction">Return</span>
                        <span key={noMatch ? "—" : trip.inbound.date} className="itin-date anim-in">
                          {noMatch ? "—" : trip.inbound.date}
                        </span>
                        <div className="itin-stats">
                          <span>Duration <span key={noMatch ? "—d" : trip.inbound.duration} className="itin-stat-val anim-in">{noMatch ? "—" : fmtDur(trip.inbound.duration)}</span></span>
                          <span className="itin-stat-sep">·</span>
                          <span>Layover <span key={noMatch ? "—l" : trip.inbound.layover} className="itin-stat-val anim-in">{noMatch ? "—" : fmtDur(trip.inbound.layover)}</span></span>
                        </div>
                      </div>
                      <TimelineBar key="inbound" flights={noMatch ? [] : trip.inbound.flights} />
                    </div>
                  )}
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
