import { useEffect, useRef, useState, type CSSProperties } from "react"
import { Routes, Route, useNavigate, useSearchParams } from "react-router-dom"
import { SearchChrome } from "./components/SearchChrome"
import type { Filters } from "./components/Sidebar"
import { StatSlider } from "./components/StatSlider"
import { StopsFilterBar } from "./components/StopsFilterBar"
import { TimelineBar } from "./components/TimelineBar"
import { BookModal } from "./components/BookModal"
import { transformApiResponse, type ApiPayload, type UiTrip } from "./lib/transformApiResponse"

const apiOrigin = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "")
const apiUrl = (path: string) => `${apiOrigin}${path}`

const CLIENT_CACHE_TTL = 60 * 60 * 1000 // 1 hour, matches server

function searchCacheKey(origin: string, destination: string, dep: string, ret: string): string {
  return `flyscan.search|${origin}|${destination}|${dep}|${ret}`
}

function searchCacheGet(key: string): ApiPayload | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const { payload, ts } = JSON.parse(raw) as { payload: ApiPayload; ts: number }
    if (Date.now() - ts > CLIENT_CACHE_TTL) { sessionStorage.removeItem(key); return null }
    return payload
  } catch { return null }
}

function searchCacheSet(key: string, payload: ApiPayload): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ payload, ts: Date.now() }))
  } catch {}
}

type TimelineRange = { start: number; end: number }
const LOADER_RADIUS_PCT = 44
const LOADER_DOT_COUNT = 18
const LOADER_DOTS = Array.from({ length: LOADER_DOT_COUNT }, (_, i) => {
  const angleDeg = -90 + (360 * i) / LOADER_DOT_COUNT
  const angle = (angleDeg * Math.PI) / 180
  return { x: 50 + Math.cos(angle) * LOADER_RADIUS_PCT, y: 50 + Math.sin(angle) * LOADER_RADIUS_PCT }
})

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

function getTimelineRange(
  trips: UiTrip[],
  pickFlights: (trip: UiTrip) => UiTrip["outbound"]["flights"] | undefined,
): TimelineRange | undefined {
  const bounds = trips
    .map(pickFlights)
    .filter((flights): flights is UiTrip["outbound"]["flights"] => Boolean(flights && flights.length > 0))
    .map((flights) => ({ start: flights[0]!.depAt, end: flights[flights.length - 1]!.arrAt }))
  if (bounds.length === 0) return undefined
  const MS_PER_HOUR = 3_600_000
  const rawStart = Math.min(...bounds.map(b => b.start))
  const rawEnd   = Math.max(...bounds.map(b => b.end))
  return {
    start: Math.floor(rawStart / MS_PER_HOUR) * MS_PER_HOUR,
    end:   Math.ceil(rawEnd   / MS_PER_HOUR) * MS_PER_HOUR,
  }
}

function computeCutoff(trips: UiTrip[]): Filters {
  if (trips.length === 0) return { price: 9999999, duration: 9999, stops: 99, layover: 9999 }
  const cmpNum = (a: number, b: number) => a - b
  const byPrice = (a: UiTrip, b: UiTrip) =>
    cmpNum(a.price, b.price) || cmpNum(a.stats.duration, b.stats.duration) ||
    cmpNum(a.stats.stops, b.stats.stops) || cmpNum(a.stats.layover, b.stats.layover)
  const byDuration = (a: UiTrip, b: UiTrip) =>
    cmpNum(a.stats.duration, b.stats.duration) || cmpNum(a.price, b.price) ||
    cmpNum(a.stats.stops, b.stats.stops) || cmpNum(a.stats.layover, b.stats.layover)
  const byStops = (a: UiTrip, b: UiTrip) =>
    cmpNum(a.stats.stops, b.stats.stops) || cmpNum(a.price, b.price) ||
    cmpNum(a.stats.duration, b.stats.duration) || cmpNum(a.stats.layover, b.stats.layover)
  const byLayover = (a: UiTrip, b: UiTrip) =>
    cmpNum(a.stats.layover, b.stats.layover) || cmpNum(a.price, b.price) ||
    cmpNum(a.stats.duration, b.stats.duration) || cmpNum(a.stats.stops, b.stats.stops)
  const candidates = [
    [...trips].sort(byPrice)[0]!,
    [...trips].sort(byDuration)[0]!,
    [...trips].sort(byStops)[0]!,
    [...trips].sort(byLayover)[0]!,
  ]
  const cutoffIndex = Math.max(
    ...candidates.map(c => trips.findIndex(t => t.id === c.id)).filter(i => i >= 0),
  )
  const cutoffTrips = trips.slice(0, cutoffIndex + 1)
  return {
    price:    Math.max(...cutoffTrips.map(t => t.price)),
    duration: Math.max(...cutoffTrips.map(t => t.stats.duration)),
    stops:    Math.max(...cutoffTrips.map(t => t.stats.stops)),
    layover:  Math.max(...cutoffTrips.map(t => t.stats.layover)),
  }
}

type Status = "idle" | "loading" | "error"

// ── Root ────────────────────────────────────────────────────────────────────

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HeroPage />} />
      <Route path="/search" element={<SearchPage />} />
    </Routes>
  )
}

// ── Hero (landing) ───────────────────────────────────────────────────────────

function HeroPage() {
  const navigate = useNavigate()

  async function onSearch(body: Record<string, unknown>) {
    const p = new URLSearchParams()
    if (body.origin)        p.set("from", String(body.origin))
    if (body.destination)   p.set("to",   String(body.destination))
    if (body.departureDate) p.set("dep",  String(body.departureDate))
    if (body.returnDate)    p.set("ret",  String(body.returnDate))
    navigate(`/search?${p}`)
  }

  return (
    <div className="app-shell">
      <SearchChrome onSearch={onSearch} busy={false} mode="hero" />
    </div>
  )
}

// ── Search (results) ─────────────────────────────────────────────────────────

function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [allTrips, setAllTrips] = useState<UiTrip[]>([])
  const [filters, setFiltersState] = useState<Filters>({ price: 9999999, duration: 9999, stops: 99, layover: 9999 })
  const [idx, setIdx] = useState(0)
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState("")
  const [bookOpen, setBookOpen] = useState(false)
  const [cutoffActive, setCutoffActive] = useState(true)

  const urlFrom = searchParams.get("from") ?? ""
  const urlTo   = searchParams.get("to")   ?? ""
  const urlDep  = searchParams.get("dep")  ?? ""
  const urlRet  = searchParams.get("ret")  ?? ""

  // Ref so loadPayload can read URL overrides without stale closure issues
  const urlOverridesRef = useRef({
    price: searchParams.get("price"),
    dur:   searchParams.get("dur"),
    stops: searchParams.get("stops"),
    lay:   searchParams.get("lay"),
    tid:   searchParams.get("tid"),
    full:  searchParams.get("full"),
  })
  urlOverridesRef.current = {
    price: searchParams.get("price"),
    dur:   searchParams.get("dur"),
    stops: searchParams.get("stops"),
    lay:   searchParams.get("lay"),
    tid:   searchParams.get("tid"),
    full:  searchParams.get("full"),
  }

  // True on first load so URL filter/idx overrides are applied once
  const isFirstLoad = useRef(true)

  const cutoff = allTrips.length > 0 ? computeCutoff(allTrips) : null

  const setFilter = (key: keyof Filters, value: number) =>
    setFiltersState(f => ({ ...f, [key]: value }))

  const visible      = filterTrips(allTrips, filters)
  const noMatch      = allTrips.length > 0 && visible.length === 0
  const clampedIdx   = visible.length > 0 ? Math.min(idx, visible.length - 1) : 0
  const trip         = visible[clampedIdx] ?? allTrips[0] ?? null
  // Timeline axis spans the "knobs at max" set so the range stays stable while dragging
  const timelineTrips = cutoffActive && cutoff ? filterTrips(allTrips, cutoff) : allTrips
  const outboundRange = getTimelineRange(timelineTrips, t => t.outbound.flights)
  const inboundRange  = getTimelineRange(timelineTrips, t => t.inbound?.flights)

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

  function navigateTrip(dir: number) {
    setIdx(Math.max(0, Math.min(visible.length - 1, clampedIdx + dir)))
  }

  function loadPayload(payload: ApiPayload) {
    const trips = transformApiResponse(payload)
    const co = computeCutoff(trips)

    let initialFilters = co
    let initialIdx = 0
    let initialCutoffActive = true

    // Apply URL filter/index overrides on first load only
    if (isFirstLoad.current) {
      const u = urlOverridesRef.current
      if (u.price != null || u.dur != null || u.stops != null || u.lay != null) {
        initialFilters = {
          price:    u.price != null ? Number(u.price) : co.price,
          duration: u.dur   != null ? Number(u.dur)   : co.duration,
          stops:    u.stops != null ? Number(u.stops)  : co.stops,
          layover:  u.lay   != null ? Number(u.lay)   : co.layover,
        }
      }
      // Restore cutoffActive from URL explicitly; default true (best data) for fresh searches
      initialCutoffActive = u.full !== "1"
      if (u.tid != null) {
        const tidIdx = trips.findIndex(t => t.id === u.tid)
        if (tidIdx >= 0) initialIdx = tidIdx
      }
      isFirstLoad.current = false
    }

    setAllTrips(trips)
    setFiltersState(initialFilters)
    setCutoffActive(initialCutoffActive)
    setIdx(initialIdx)
    setStatus("idle")
  }

  const loadPayloadRef = useRef(loadPayload)
  loadPayloadRef.current = loadPayload

  const fixtureApplyRef = useRef<((inp: NonNullable<ApiPayload["input"]>) => void) | null>(null)

  async function loadDemo() {
    setStatus("loading")
    setErrorMsg("")
    try {
      let data: ApiPayload | null = null
      try {
        const res = await fetch(apiUrl("/api/fixture-demo"))
        const remote = await res.json().catch(() => ({})) as ApiPayload
        console.log("[flyscan] /api/fixture-demo response", remote)
        if (res.ok) data = remote
      } catch {
        // Backend may be unavailable; fall through to local fixture.
      }
      if (!data) {
        const local = await import("@fx/fixture")
        data = local.fixture as ApiPayload
        console.log("[flyscan] local fixture fallback", data)
      }
      if (data.input) fixtureApplyRef.current?.(data.input)
      loadPayloadRef.current(data)
    } catch (err) {
      setStatus("error")
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  const loadDemoRef = useRef(loadDemo)
  loadDemoRef.current = loadDemo

  async function doSearch(body: Record<string, unknown>) {
    const key = searchCacheKey(
      String(body.origin ?? ""),
      String(body.destination ?? ""),
      String(body.departureDate ?? ""),
      String(body.returnDate ?? ""),
    )
    const cached = searchCacheGet(key)
    if (cached) {
      loadPayload(cached)
      return
    }
    setStatus("loading")
    setErrorMsg("")
    try {
      const res = await fetch(apiUrl("/api/search"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({})) as ApiPayload
      console.log("[flyscan] /api/search response", data)
      if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText)
      searchCacheSet(key, data)
      loadPayload(data)
    } catch (err) {
      setStatus("error")
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  const doSearchRef = useRef(doSearch)
  doSearchRef.current = doSearch

  async function onSearch(body: Record<string, unknown>) {
    // Reset so next loadPayload won't re-apply old URL overrides
    isFirstLoad.current = true
    const p = new URLSearchParams()
    if (body.origin)        p.set("from", String(body.origin))
    if (body.destination)   p.set("to",   String(body.destination))
    if (body.departureDate) p.set("dep",  String(body.departureDate))
    if (body.returnDate)    p.set("ret",  String(body.returnDate))
    setSearchParams(p, { replace: true })
    await doSearch(body)
  }

  // Auto-trigger search from URL params on mount
  const didAutoSearch = useRef(false)
  useEffect(() => {
    if (didAutoSearch.current) return
    if (searchParams.get("fixture") === "1") {
      didAutoSearch.current = true
      void loadDemoRef.current()
      return
    }
    if (urlFrom && urlTo && urlDep) {
      didAutoSearch.current = true
      void doSearchRef.current({
        origin: urlFrom,
        destination: urlTo,
        departureDate: urlDep,
        returnDate: urlRet || undefined,
        sources: ["skyscanner", "kiwi"],
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync filters, cutoff toggle, and trip index to URL whenever they change (results visible)
  useEffect(() => {
    if (status !== "idle" || allTrips.length === 0) return
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set("price", String(filters.price))
      next.set("dur",   String(filters.duration))
      next.set("stops", String(filters.stops))
      next.set("lay",   String(filters.layover))
      if (!cutoffActive) next.set("full", "1")
      else next.delete("full")
      const currentTripId = visible[clampedIdx]?.id
      if (currentTripId) next.set("tid", currentTripId)
      else next.delete("tid")
      return next
    }, { replace: true })
  // clampedIdx is derived from idx+visible, include both
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, cutoffActive, clampedIdx, status, allTrips.length])

  // Expose loadDemo on window for devtools
  useEffect(() => {
    window.flyscan = { loadDemo: () => loadDemoRef.current() }
    return () => { window.flyscan = undefined }
  }, [])

  const initialValues = urlFrom && urlTo
    ? { origin: urlFrom, destination: urlTo, departureDate: urlDep, returnDate: urlRet, roundTrip: Boolean(urlRet) }
    : undefined

  return (
    <div className="app-shell">
      <SearchChrome
        onSearch={onSearch}
        busy={status === "loading"}
        mode="bar"
        initialValues={initialValues}
        fixtureApplyRef={fixtureApplyRef}
      />

      <div className="workspace">
        <main className="main-col">
          {status === "loading" && (
            <div className="empty-state empty-state--fullscreen">
              <div
                className="loading-plane"
                aria-hidden="true"
                style={{ ["--loader-n" as "--loader-n"]: LOADER_DOT_COUNT } as CSSProperties}
              >
                <div className="loading-plane__orbit">
                  {LOADER_DOTS.map((dot, i) => (
                    <span
                      key={i}
                      className="loading-plane__dot"
                      style={{ left: `${dot.x}%`, top: `${dot.y}%`, ["--dot-i" as "--dot-i"]: i } as CSSProperties}
                    />
                  ))}
                  <div className="loading-plane__carrier">
                    <div className="loading-plane__arm">
                      <div className="loading-plane__glyph">✈</div>
                    </div>
                  </div>
                </div>
              </div>
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
              <p className="empty-text">Run a search to view trips.</p>
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
                    onClick={() => navigateTrip(-1)}
                  >
                    <span className="arrow-btn-icon" aria-hidden="true">←</span>
                    <span className="arrow-btn-label">Prev</span>
                  </button>
                  <button
                    type="button"
                    className="arrow-btn"
                    disabled={clampedIdx >= visible.length - 1}
                    aria-label="Next trip"
                    onClick={() => navigateTrip(1)}
                  >
                    <span className="arrow-btn-label">Next</span>
                    <span className="arrow-btn-icon" aria-hidden="true">→</span>
                  </button>
                </div>
                <span className="trip-counter">
                  {visible.length === 0 ? "No trips match filters" : `Trip ${clampedIdx + 1} of ${visible.length}`}
                </span>
                {cutoff && (
                  <div className="cutoff-group">
                    <button type="button" className="cutoff-toggle" onClick={toggleCutoff}>
                      {cutoffActive ? "use all data" : "use best data"}
                    </button>
                  </div>
                )}
                <div className="nav-spacer" />
                {!noMatch && trip && (
                  <button className="book-btn" onClick={() => setBookOpen(true)}>Book</button>
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
                          label="Duration" hideLabel
                          value={filters.duration} min={absMinDur} max={sliderMaxDur} step={30}
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
                          label="Layover" hideLabel
                          value={filters.layover} min={absMinLay} max={sliderMaxLay} step={15}
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
                            label="Stops" hideLabel
                            value={filters.stops} min={absMinStops} max={sliderMaxStops}
                            onChange={v => setFilter("stops", v)}
                            tripValue={noMatch ? null : trip.stats.stops}
                          />
                        </div>
                      )}
                    </div>
                    <div className="price-hero-stack">
                      <div className="price-hero-header">
                        {absMinStops < sliderMaxStops && (
                          <div className="trip-stat-stack trip-stat-stack--stops-mobile">
                            <div className="trip-stat-hero-row">
                              <span className="stat-name">Stops</span>
                            </div>
                            <StopsFilterBar
                              label="Stops" hideLabel
                              value={filters.stops} min={absMinStops} max={sliderMaxStops}
                              onChange={v => setFilter("stops", v)}
                              tripValue={noMatch ? null : trip.stats.stops}
                            />
                          </div>
                        )}
                        <div className={`price-hero-row${noMatch ? " no-match-dim" : ""}`}>
                          <span className="stat-name">Price</span>
                          <div key={noMatch ? "—" : trip.price} className="price-hero anim-in">
                            {noMatch ? "—" : fmtPrice(trip.price, trip.currency)}
                          </div>
                        </div>
                      </div>
                      <StatSlider
                        label="Price" hideLabel
                        value={filters.price} min={absMinPrice} max={sliderMaxPrice} step={priceStep}
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
                    <TimelineBar key="outbound" flights={noMatch ? [] : trip.outbound.flights} range={outboundRange} />
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
                      <TimelineBar key="inbound" flights={noMatch ? [] : trip.inbound.flights} range={inboundRange} />
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
