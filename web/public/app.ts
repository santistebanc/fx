/** Minimal shapes used by the UI (matches `/api/search` JSON). */
interface UiDeal {
  id: string
  trip: string
  price: number
  provider: string
  link: string
  /** Present on round-trip fares from the API (optional on merged payloads). */
  return_date?: string | null
  origin?: string
  destination?: string
}

interface UiFlight {
  id: string
  airline: string
  flight_number: string
  origin: string
  destination: string
  departure_time: string
  arrival_time: string
  departure_date: string
  /** ISO date (YYYY-MM-DD); omitting uses departure_date + duration heuristic */
  arrival_date?: string
  duration: number
}

interface UiLeg {
  id: string
  trip: string
  flight: string
  inbound: boolean
  order: number
  connection_time?: number | null
}

type ApiSuccessBlock = {
  ok: true
  source: string
  metadata?: { timeSpentMs?: number }
  deals: UiDeal[]
  legs?: UiLeg[]
  flights?: UiFlight[]
}

type ApiErrorBlock = {
  ok: false
  source: string
  error: string
}

type SearchPayload = {
  mode?: string
  input?: {
    origin?: string
    destination?: string
    departureDate?: string
    returnDate?: string
  }
  sources?: Array<ApiSuccessBlock | ApiErrorBlock>
}

function qs<T extends HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector(sel)
  if (!el) throw new Error(`Missing element: ${sel}`)
  return el as T
}

const form = qs<HTMLFormElement>("#search-form")
const btn = qs<HTMLButtonElement>("#submit-btn")
const loadFixtureBtn = qs<HTMLButtonElement>("#load-fixture-demo")
const resultsRoot = qs<HTMLDivElement>("#results-root")
const overviewEl = qs<HTMLParagraphElement>("#results-overview")
const ph = qs<HTMLParagraphElement>("#results-placeholder")
const errEl = qs<HTMLParagraphElement>("#results-error")
const statusEl = qs<HTMLParagraphElement>("#results-status")
const resultsPanel = qs<HTMLElement>("#results-panel")

const LOADING_HINT = "Searching… Live requests can take up to a minute — hang tight."
const IDLE_PLACEHOLDER = "Run a search to see trips and prices. All selected feeds are merged into one list ranked by best fare per trip."

const fmtMoney = (cents: number, currency = "EUR"): string => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100)
  } catch {
    return `€${(cents / 100).toFixed(0)}`
  }
}

const fmtDateShort = (iso: string): string => {
  if (!iso) return "—"
  const d = new Date(iso + "T12:00:00Z")
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(d)
}

const fmtDur = (minutes: number | null | undefined): string => {
  if (minutes == null || Number.isNaN(minutes)) return "—"
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h <= 0) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}

/** Parse API date+time as UTC (matches backend ISO convention). */
function flightDepartMs(f: UiFlight): number | null {
  const t = Date.parse(`${f.departure_date}T${f.departure_time}:00Z`)
  return Number.isFinite(t) ? t : null
}

function flightArriveMs(f: UiFlight): number | null {
  const dep = flightDepartMs(f)
  if (dep == null) return null
  if (f.arrival_date) {
    const t = Date.parse(`${f.arrival_date}T${f.arrival_time}:00Z`)
    if (Number.isFinite(t)) return t
  }
  if (f.duration != null && Number.isFinite(f.duration)) return dep + f.duration * 60_000
  const t = Date.parse(`${f.departure_date}T${f.arrival_time}:00Z`)
  return Number.isFinite(t) ? t : null
}

function addCalendarDayIso(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Wall-clock endpoints for timeline geometry. Feeds sometimes put arrival clock before departure
 * on the same calendar date for westbound long-hauls; prefer duration, then next-day arrival date.
 */
function flightSegmentEndpointsMs(f: UiFlight): { depMs: number; arrMs: number } | null {
  const depMs = flightDepartMs(f)
  if (depMs == null) return null

  let arrMs = flightArriveMs(f)
  if (arrMs == null) {
    const dur = f.duration
    if (dur != null && dur > 0 && Number.isFinite(dur)) arrMs = depMs + dur * 60_000
    else return null
  }

  if (arrMs <= depMs) {
    const dur = f.duration
    if (dur != null && dur > 0 && Number.isFinite(dur)) {
      arrMs = depMs + dur * 60_000
    } else {
      const rolled = Date.parse(`${addCalendarDayIso(flightArrDateIso(f))}T${f.arrival_time}:00Z`)
      if (Number.isFinite(rolled) && rolled > depMs) arrMs = rolled
      else return null
    }
  }

  return { depMs, arrMs }
}

function fmtEndpointDate(isoDate: string): string {
  if (!isoDate) return "—"
  const d = new Date(isoDate + "T12:00:00Z")
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(d)
}

function fmtClock(timeStr: string): string {
  return timeStr && timeStr.length >= 4 ? timeStr.slice(0, 5) : timeStr || "—"
}

const TRIP_SEGMENT_HUES = [215, 155, 285, 42, 330, 175]

function segmentHueCss(index: number): string {
  const h = TRIP_SEGMENT_HUES[index % TRIP_SEGMENT_HUES.length]!
  return `oklch(0.72 0.14 ${h} / 0.92)`
}

function wireRoundTrip(): void {
  const rt = form.elements.namedItem("roundTrip")
  const ret = form.elements.namedItem("returnDate")
  if (!(rt instanceof HTMLInputElement) || !(ret instanceof HTMLInputElement)) return
  const onChange = () => {
    ret.disabled = !rt.checked
    ret.required = rt.checked
  }
  rt.addEventListener("change", onChange)
  onChange()
}

function upperIata(el: HTMLInputElement): void {
  el.addEventListener("blur", () => {
    el.value = el.value.trim().toUpperCase().slice(0, 3)
  })
}

upperIata(form.elements.namedItem("origin") as HTMLInputElement)
upperIata(form.elements.namedItem("destination") as HTMLInputElement)

wireRoundTrip()

function resetResultsUi(): void {
  errEl.classList.add("hidden")
  errEl.hidden = true
  resultsRoot.classList.add("hidden")
  resultsRoot.hidden = true
  ph.classList.remove("hidden")
  statusEl.textContent = ""
  overviewEl.replaceChildren()
  overviewEl.classList.add("hidden")
  overviewEl.hidden = true
}

function applyFixtureInputToForm(inp: NonNullable<SearchPayload["input"]>): void {
  const originIn = form.elements.namedItem("origin") as HTMLInputElement
  const destIn = form.elements.namedItem("destination") as HTMLInputElement
  const depIn = form.elements.namedItem("departureDate") as HTMLInputElement
  const retIn = form.elements.namedItem("returnDate") as HTMLInputElement
  const rt = form.elements.namedItem("roundTrip") as HTMLInputElement
  if (inp.origin) originIn.value = inp.origin.trim().toUpperCase().slice(0, 3)
  if (inp.destination) destIn.value = inp.destination.trim().toUpperCase().slice(0, 3)
  if (inp.departureDate) depIn.value = inp.departureDate
  if (inp.returnDate != null && String(inp.returnDate).length > 0) {
    rt.checked = true
    retIn.disabled = false
    retIn.required = true
    retIn.value = String(inp.returnDate)
  } else {
    rt.checked = false
    retIn.disabled = true
    retIn.required = false
    retIn.value = ""
  }
}

const PAGE_SIZE_OPTIONS = [10, 15, 25, 50, 100]

/** Paginates full result sets from the API (client-side only; backend sends all deals). */
function appendPaginatedList<T>(
  parent: HTMLElement,
  options: {
    items: readonly T[]
    renderItem: (item: T) => HTMLElement
    itemLabel?: string
    listClassName?: string
    pageSizes?: readonly number[]
    initialPageSize?: number
  }
): void {
  const {
    items,
    renderItem,
    itemLabel = "items",
    listClassName = "trip-list",
    pageSizes = PAGE_SIZE_OPTIONS,
    initialPageSize = 15,
  } = options

  const listHost = document.createElement("div")
  listHost.className = listClassName
  listHost.tabIndex = -1

  const pager = document.createElement("div")
  pager.className = "trip-pager"

  const nav = document.createElement("nav")
  nav.className = "trip-pager-nav"
  nav.setAttribute("aria-label", `${itemLabel} pages`)

  const prev = document.createElement("button")
  prev.type = "button"
  prev.className = "pager-btn"
  prev.textContent = "Previous"

  const next = document.createElement("button")
  next.type = "button"
  next.className = "pager-btn"
  next.textContent = "Next"

  let scrollAfterDraw = false

  const info = document.createElement("span")
  info.className = "trip-pager-info"

  const sizeLabel = document.createElement("label")
  sizeLabel.className = "pager-size-label"
  const select = document.createElement("select")
  select.className = "pager-size-select"
  select.setAttribute("aria-label", `${itemLabel} per page`)
  for (const n of pageSizes) {
    const o = document.createElement("option")
    o.value = String(n)
    o.textContent = `${n} per page`
    select.appendChild(o)
  }

  const pickSize = pageSizes.includes(initialPageSize) ? initialPageSize : pageSizes[0]!
  select.value = String(pickSize)

  let page = 0
  let pageSize = Number(select.value)

  function totalPages() {
    const n = items.length
    if (n === 0) return 1
    return Math.ceil(n / pageSize)
  }

  function draw() {
    listHost.innerHTML = ""
    let tp = totalPages()
    if (page >= tp) page = tp - 1
    if (page < 0) page = 0
    tp = totalPages()
    const start = page * pageSize
    const slice = items.slice(start, start + pageSize)
    for (const item of slice) {
      listHost.appendChild(renderItem(item))
    }

    const n = items.length
    if (n === 0) {
      info.textContent = `No ${itemLabel}`
      prev.disabled = true
      next.disabled = true
      select.disabled = true
    } else {
      select.disabled = false
      const from = start + 1
      const to = start + slice.length
      info.textContent = `${itemLabel} ${from}–${to} of ${n} · page ${page + 1} of ${tp}`
      prev.disabled = page <= 0
      next.disabled = page >= tp - 1
    }

    if (scrollAfterDraw && n > 0) {
      listHost.scrollIntoView({ behavior: "smooth", block: "nearest" })
      scrollAfterDraw = false
    }
  }

  prev.addEventListener("click", () => {
    scrollAfterDraw = true
    page = Math.max(0, page - 1)
    draw()
  })
  next.addEventListener("click", () => {
    scrollAfterDraw = true
    page = Math.min(totalPages() - 1, page + 1)
    draw()
  })
  select.addEventListener("change", () => {
    scrollAfterDraw = true
    pageSize = Number(select.value)
    page = 0
    draw()
  })

  nav.append(prev, next)
  sizeLabel.append(document.createTextNode("Show "), select)
  pager.append(nav, info, sizeLabel)

  parent.append(listHost, pager)
  draw()
}

form.addEventListener("submit", async (e) => {
  e.preventDefault()
  resetResultsUi()

  const originIn = form.elements.namedItem("origin") as HTMLInputElement
  const destIn = form.elements.namedItem("destination") as HTMLInputElement
  originIn.value = originIn.value.trim().toUpperCase().slice(0, 3)
  destIn.value = destIn.value.trim().toUpperCase().slice(0, 3)

  ph.textContent = LOADING_HINT

  const fd = new FormData(form)
  const sources: ("skyscanner" | "kiwi")[] = []
  if (fd.get("srcSky")) sources.push("skyscanner")
  if (fd.get("srcKiwi")) sources.push("kiwi")

  const body: Record<string, unknown> = {
    origin: fd.get("origin"),
    destination: fd.get("destination"),
    departureDate: fd.get("departureDate"),
    returnDate: fd.get("roundTrip") ? fd.get("returnDate") : undefined,
    sources,
  }

  btn.disabled = true
  loadFixtureBtn.disabled = true
  btn.setAttribute("aria-busy", "true")
  btn.textContent = "Searching…"

  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error || res.statusText || "Request failed")
    }
    console.log("[fx] scraped search payload", data)
    renderResults(data as SearchPayload)
    ph.classList.add("hidden")
    resultsRoot.classList.remove("hidden")
    resultsRoot.hidden = false
    requestAnimationFrame(() => {
      resultsPanel?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  } catch (err: unknown) {
    if (overviewEl) {
      overviewEl.replaceChildren()
      overviewEl.classList.add("hidden")
      overviewEl.hidden = true
    }
    errEl.textContent = err instanceof Error ? err.message : String(err)
    errEl.classList.remove("hidden")
    errEl.hidden = false
    ph.textContent = IDLE_PLACEHOLDER
    ph.classList.remove("hidden")
  } finally {
    btn.disabled = false
    loadFixtureBtn.disabled = false
    btn.setAttribute("aria-busy", "false")
    btn.textContent = "Search flights"
  }
})

loadFixtureBtn.addEventListener("click", async () => {
  resetResultsUi()
  ph.textContent = "Loading demo snapshot…"

  btn.disabled = true
  loadFixtureBtn.disabled = true
  loadFixtureBtn.setAttribute("aria-busy", "true")

  try {
    const res = await fetch("/api/fixture-demo")
    const data: unknown = await res.json().catch(() => ({}))
    if (!res.ok) {
      const errObj = data as { error?: string }
      throw new Error(errObj.error || res.statusText || "Failed to load demo snapshot")
    }
    const payload = data as SearchPayload
    if (payload.input && typeof payload.input === "object") {
      applyFixtureInputToForm(payload.input)
    }
    console.log("[fx] fixture demo snapshot", payload)
    renderResults(payload)
    ph.classList.add("hidden")
    resultsRoot.classList.remove("hidden")
    resultsRoot.hidden = false
    requestAnimationFrame(() => {
      resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  } catch (err: unknown) {
    errEl.textContent = err instanceof Error ? err.message : String(err)
    errEl.classList.remove("hidden")
    errEl.hidden = false
    ph.textContent = IDLE_PLACEHOLDER
    ph.classList.remove("hidden")
  } finally {
    btn.disabled = false
    loadFixtureBtn.disabled = false
    loadFixtureBtn.setAttribute("aria-busy", "false")
  }
})

/** Merge successful API blocks into one graph (dedupe by entity id; first wins). */
function mergeSuccessfulSources(successBlocks: ApiSuccessBlock[]): {
  deals: UiDeal[]
  flights: UiFlight[]
  legs: UiLeg[]
  maxTimeSpentMs: number
} {
  const dealsById = new Map<string, UiDeal>()
  const flightsById = new Map<string, UiFlight>()
  const legsById = new Map<string, UiLeg>()
  let maxTimeSpentMs = 0

  for (const block of successBlocks) {
    maxTimeSpentMs = Math.max(maxTimeSpentMs, block.metadata?.timeSpentMs ?? 0)
    for (const d of block.deals ?? []) {
      if (!dealsById.has(d.id)) dealsById.set(d.id, d)
    }
    const flights = block.flights
    if (Array.isArray(flights)) {
      for (const f of flights) {
        if (!flightsById.has(f.id)) flightsById.set(f.id, f)
      }
    }
    const legs = block.legs
    if (Array.isArray(legs)) {
      for (const l of legs) {
        if (!legsById.has(l.id)) legsById.set(l.id, l)
      }
    }
  }

  return {
    deals: [...dealsById.values()],
    flights: [...flightsById.values()],
    legs: [...legsById.values()],
    maxTimeSpentMs,
  }
}

function fillResultsOverview(summary: {
  totalDeals: number
  routeCount: number
  failures: ApiErrorBlock[]
}): void {
  if (!overviewEl) return
  overviewEl.replaceChildren()

  const { totalDeals, routeCount, failures } = summary

  const parts = []
  if (totalDeals > 0) {
    parts.push(`${totalDeals} offer${totalDeals === 1 ? "" : "s"} · ${routeCount} route${routeCount === 1 ? "" : "s"} · ranked by best price per trip`)
  } else {
    parts.push("No offers returned")
  }

  if (failures.length > 0) {
    parts.push(failures.map((f) => `${titleCase(f.source)} unavailable`).join(" · "))
  }

  overviewEl.appendChild(document.createTextNode(parts.join(" · ")))

  overviewEl.classList.remove("hidden")
  overviewEl.hidden = false
}

function renderResults(payload: SearchPayload): void {
  resultsRoot.innerHTML = ""

  const sources = Array.isArray(payload.sources) ? payload.sources : []
  const failures: ApiErrorBlock[] = []
  const successes: ApiSuccessBlock[] = []
  for (const block of sources) {
    if (!block.ok) failures.push(block)
    else successes.push(block)
  }

  const merged = mergeSuccessfulSources(successes)
  const routeCount = new Set(merged.deals.map((d) => d.trip)).size

  fillResultsOverview({
    totalDeals: merged.deals.length,
    routeCount,
    failures,
  })

  const announcements = []
  if (merged.deals.length > 0) {
    announcements.push(`${merged.deals.length} offers · ${routeCount} routes, ranked by lowest fare per trip`)
  }
  for (const f of failures) {
    announcements.push(`${titleCase(f.source)} failed`)
  }

  for (const block of failures) {
    const wrap = document.createElement("div")
    wrap.className = "source-block source-block-error"
    wrap.innerHTML = `
        <div class="source-head">
          <h3 class="source-name">${escapeHtml(block.source)}</h3>
        </div>
        <p class="source-error">${escapeHtml(block.error)}</p>`
    resultsRoot.appendChild(wrap)
  }

  const wrap = document.createElement("div")
  wrap.className = "source-block source-block-unified"

  const head = document.createElement("div")
  head.className = "source-head"
  const h3 = document.createElement("h3")
  h3.className = "source-name"
  h3.textContent = "Trips & prices"
  const pm = document.createElement("p")
  pm.className = "source-meta"
  if (merged.deals.length === 0) {
    pm.textContent =
      successes.length === 0
        ? "No results — fix errors above or adjust search."
        : "No fares for this search. Try different dates or airports."
  } else {
    pm.textContent = `Sorted by lowest fare per trip · ${routeCount} route${routeCount === 1 ? "" : "s"} · ${merged.deals.length} booking option${merged.deals.length === 1 ? "" : "s"} · ${(merged.maxTimeSpentMs / 1000).toFixed(1)} s`
  }
  head.append(h3, pm)

  const bodyCol = document.createElement("div")
  bodyCol.className = "source-results-body"

  if (merged.deals.length === 0) {
    const empty = document.createElement("p")
    empty.className = "results-empty"
    empty.textContent =
      successes.length === 0
        ? "No data — all selected sources failed or returned nothing."
        : "No fares returned for this search. Try different dates or airports, or switch data mode if the portal is unavailable."
    bodyCol.appendChild(empty)
  } else if (!Array.isArray(merged.legs) || !Array.isArray(merged.flights) || merged.legs.length === 0 || merged.flights.length === 0) {
    const warn = document.createElement("p")
    warn.className = "trip-missing"
    warn.textContent = "Flight breakdown unavailable for some results — showing flat fare list."
    bodyCol.appendChild(warn)
    const sortedDeals = [...merged.deals].sort((a, b) => a.price - b.price || String(a.id).localeCompare(String(b.id)))
    appendPaginatedList(bodyCol, {
      items: sortedDeals,
      renderItem: (d) => renderDealChip(d),
      itemLabel: "Offers",
      listClassName: "trip-deals trip-deals-standalone",
    })
  } else {
    const flightById = new Map(merged.flights.map((f) => [f.id, f]))
    const dealsByTrip = groupDealsByTrip(merged.deals)
    const sortedTripIds = sortTripIdsByMinDealPrice(dealsByTrip)
    appendPaginatedList(bodyCol, {
      items: sortedTripIds,
      renderItem: (tripId) => renderTripCard(tripId, merged.legs, flightById, dealsByTrip.get(tripId)),
      itemLabel: "Trips",
      listClassName: "trip-list",
    })
  }

  wrap.append(head, bodyCol)
  resultsRoot.appendChild(wrap)

  if (statusEl) {
    statusEl.textContent = announcements.length ? announcements.join(". ") + "." : ""
  }
}

function minDealPrice(deals: readonly UiDeal[] | undefined): number {
  if (!deals?.length) return Number.POSITIVE_INFINITY
  return Math.min(...deals.map((d) => d.price))
}

/** Trip order: cheapest “best offer” in the trip first (min deal price), then stable tie-break. */
function sortTripIdsByMinDealPrice(dealsByTrip: Map<string, UiDeal[]>): string[] {
  return [...dealsByTrip.keys()].sort((a, b) => {
    const pa = minDealPrice(dealsByTrip.get(a))
    const pb = minDealPrice(dealsByTrip.get(b))
    if (pa !== pb) return pa - pb
    return String(a).localeCompare(String(b))
  })
}

function groupDealsByTrip(deals: readonly UiDeal[]): Map<string, UiDeal[]> {
  const m = new Map<string, UiDeal[]>()
  for (const d of deals) {
    if (!m.has(d.trip)) m.set(d.trip, [])
    m.get(d.trip)!.push(d)
  }
  return m
}

function sortLegs(legs: readonly UiLeg[], inbound: boolean): UiLeg[] {
  return legs.filter((l) => legIsInbound(l) === inbound).sort((a, b) => a.order - b.order)
}

function legIsInbound(leg: UiLeg): boolean {
  const v = leg.inbound as unknown
  return v === true || v === "true" || v === 1
}

function airportCode3(raw: string): string {
  return String(raw)
    .trim()
    .toUpperCase()
    .slice(0, 3)
}

/** When ids encode direction (`*_outbound_*` / `*_inbound_*`), that wins over leg flags (fixes bad flags / merged graphs). */
function partitionTripLegs(legsForTrip: readonly UiLeg[]): { outbound: UiLeg[]; inbound: UiLeg[] } {
  const inferInbound = legsForTrip.filter((l) => String(l.id).includes("_inbound_")).sort((a, b) => a.order - b.order)
  const inferOutbound = legsForTrip.filter((l) => String(l.id).includes("_outbound_")).sort((a, b) => a.order - b.order)

  if (inferInbound.length > 0) {
    const outbound =
      inferOutbound.length > 0
        ? inferOutbound
        : legsForTrip.filter((l) => !inferInbound.some((x) => x.id === l.id)).sort((a, b) => a.order - b.order)
    return { outbound, inbound: inferInbound }
  }

  return {
    outbound: sortLegs(legsForTrip, false),
    inbound: sortLegs(legsForTrip, true),
  }
}

/**
 * First leg departing from `destinationIata` (deal destination) starts the return; earlier legs are outbound.
 * Used when flags/ids did not separate directions but the fare is round-trip.
 */
function trySplitReturnByDestination(
  legsForTrip: readonly UiLeg[],
  flightById: Map<string, UiFlight>,
  destinationIata: string
): { outbound: UiLeg[]; inbound: UiLeg[] } | null {
  const dest = airportCode3(destinationIata)
  if (dest.length !== 3) return null

  type Row = { leg: UiLeg; dep: number }
  const rows: Row[] = []
  for (const leg of legsForTrip) {
    const f = flightById.get(leg.flight)
    if (!f) continue
    const dep = flightDepartMs(f)
    if (dep == null) continue
    rows.push({ leg, dep })
  }
  if (rows.length < 2) return null

  rows.sort((a, b) => a.dep - b.dep)

  const idx = rows.findIndex((r) => {
    const fl = flightById.get(r.leg.flight)
    return fl != null && airportCode3(fl.origin) === dest
  })
  if (idx <= 0) return null

  const outbound = rows.slice(0, idx).map((r) => r.leg).sort((a, b) => a.order - b.order)
  const inbound = rows.slice(idx).map((r) => r.leg).sort((a, b) => a.order - b.order)
  if (inbound.length === 0) return null
  return { outbound, inbound }
}

function tripDealsSuggestReturn(deals: readonly UiDeal[] | undefined): boolean {
  const list = deals ?? []
  return list.some((d) => {
    const r = d.return_date
    return r != null && String(r).length > 0
  })
}

function bestDealPriceCents(deals: readonly UiDeal[] | undefined): number | null {
  const list = Array.isArray(deals) ? deals : []
  if (list.length === 0) return null
  return Math.min(...list.map((d) => d.price))
}

function renderTripCard(
  tripId: string,
  allLegs: readonly UiLeg[],
  flightById: Map<string, UiFlight>,
  deals: readonly UiDeal[] | undefined
): HTMLElement {
  const dealList = Array.isArray(deals) ? deals : []

  const card = document.createElement("article")
  card.className = "trip-card"

  const legsForTrip = allLegs.filter((l) => l.trip === tripId)
  let { outbound, inbound } = partitionTripLegs(legsForTrip)

  const destHint = dealList.map((d) => d.destination).find((x) => typeof x === "string" && airportCode3(x).length === 3)

  if (inbound.length === 0 && destHint && tripDealsSuggestReturn(dealList)) {
    const alt = trySplitReturnByDestination(legsForTrip, flightById, destHint)
    if (alt) {
      outbound = alt.outbound
      inbound = alt.inbound
    }
  }

  const showReturnRow = inbound.length > 0 || tripDealsSuggestReturn(dealList)

  const head = document.createElement("header")
  head.className = "trip-card-head"

  const headMain = document.createElement("div")
  headMain.className = "trip-card-head-main"
  const idSpan = document.createElement("span")
  idSpan.className = "trip-id"
  idSpan.textContent = shortId(tripId)
  idSpan.title = `Trip id: ${tripId}`
  const countSpan = document.createElement("span")
  countSpan.className = "trip-deal-count"
  countSpan.textContent = `${dealList.length} booking option${dealList.length === 1 ? "" : "s"}`
  headMain.append(idSpan, countSpan)

  const headAside = document.createElement("div")
  headAside.className = "trip-card-head-aside"
  const fromLbl = document.createElement("span")
  fromLbl.className = "trip-from-label"
  fromLbl.textContent = "Best fare"
  const priceEl = document.createElement("span")
  priceEl.className = "trip-from-price"
  const best = bestDealPriceCents(dealList)
  priceEl.textContent = best != null ? fmtMoney(best, "EUR") : "—"
  headAside.append(fromLbl, priceEl)

  head.append(headMain, headAside)

  const itin = document.createElement("div")
  itin.className = "trip-itinerary"

  if (outbound.length === 0 && inbound.length === 0) {
    const miss = document.createElement("p")
    miss.className = "trip-missing"
    miss.textContent = "No leg breakdown in data for this trip."
    itin.appendChild(miss)
  } else {
    itin.appendChild(renderDirection("Outbound", outbound, flightById))
    if (showReturnRow) {
      itin.appendChild(renderDirection("Return", inbound, flightById))
    }
  }

  const dealsRow = document.createElement("div")
  dealsRow.className = "trip-deals"
  const sortedDeals = [...dealList].sort((a, b) => a.price - b.price)
  for (const deal of sortedDeals) {
    dealsRow.appendChild(renderDealChip(deal))
  }

  card.append(head, itin, dealsRow)
  return card
}

function renderDirection(label: string, legs: UiLeg[], flightById: Map<string, UiFlight>): HTMLElement {
  const wrap = document.createElement("section")
  wrap.className = "trip-direction"
  const h = document.createElement("h4")
  h.className = "trip-direction-title"
  h.textContent = label

  if (legs.length === 0) {
    const miss = document.createElement("p")
    miss.className = "trip-missing"
    miss.textContent = "No flight segments for this direction in the merged data."
    wrap.append(h, miss)
    return wrap
  }

  const timeline = buildTripTimeline(legs, flightById)
  if (timeline) {
    wrap.append(h, timeline.root)
  } else {
    const ol = document.createElement("ol")
    ol.className = "leg-list"
    for (const leg of legs) {
      ol.appendChild(renderLegItem(leg, flightById.get(leg.flight)))
    }
    wrap.append(h, ol)
  }
  return wrap
}

type TripTimelineSeg = {
  leg: UiLeg
  flight: UiFlight
  depMs: number
  arrMs: number
}

function pctOnSpan(ms: number, t0: number, span: number): number {
  if (!(span > 0)) return 0
  const raw = ((ms - t0) / span) * 100
  return Math.max(0, Math.min(100, raw))
}

const MS_PER_DAY = 86_400_000

/** First 00:00:00.000 UTC strictly after `ms`. */
function firstUtcMidnightStrictlyAfter(ms: number): number {
  const d = new Date(ms)
  const startOfDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
  if (startOfDay > ms) return startOfDay
  return startOfDay + MS_PER_DAY
}

/** Horizontal positions (% of timeline) for calendar-day boundaries inside layover gaps. */
function layoverCalendarDividerPcts(segs: TripTimelineSeg[], t0: number, span: number): number[] {
  const out: number[] = []
  for (let i = 0; i < segs.length - 1; i++) {
    const gapStart = segs[i]!.arrMs
    const gapEnd = segs[i + 1]!.depMs
    if (!(gapEnd > gapStart)) continue

    const forThisGap: number[] = []
    let boundary = firstUtcMidnightStrictlyAfter(gapStart)
    while (boundary < gapEnd) {
      forThisGap.push(pctOnSpan(boundary, t0, span))
      boundary += MS_PER_DAY
    }

    if (
      forThisGap.length === 0 &&
      flightArrDateIso(segs[i]!.flight) !== flightDepDateIso(segs[i + 1]!.flight)
    ) {
      const mid = gapStart + (gapEnd - gapStart) / 2
      forThisGap.push(pctOnSpan(mid, t0, span))
    }

    out.push(...forThisGap)
  }
  return out
}

function markerAnchorClass(pct: number): "trip-bar-marker-start" | "trip-bar-marker-mid" | "trip-bar-marker-end" {
  if (pct <= 1.25) return "trip-bar-marker-start"
  if (pct >= 98.75) return "trip-bar-marker-end"
  return "trip-bar-marker-mid"
}

function flightDepDateIso(f: UiFlight): string {
  return f.departure_date
}

function flightArrDateIso(f: UiFlight): string {
  return f.arrival_date ?? f.departure_date
}

/** Marker body: show calendar date only when it differs from the previous timeline endpoint (`prevIso` is YYYY-MM-DD or null). */
function tripMarkerDatetimeHtml(isoDate: string, timeStr: string, prevIso: string | null): string {
  const showDate = prevIso === null || isoDate !== prevIso
  const timeHtml = `<span class="trip-bar-marker-time">${escapeHtml(fmtClock(timeStr))}</span>`
  if (!showDate) {
    return `<span class="trip-bar-marker-datetime trip-bar-marker-datetime-compact">${timeHtml}</span>`
  }
  return `<span class="trip-bar-marker-datetime">
        <span class="trip-bar-marker-date">${escapeHtml(fmtEndpointDate(isoDate))}</span>
        ${timeHtml}
      </span>`
}

function buildTripTimeline(legs: UiLeg[], flightById: Map<string, UiFlight>): { root: HTMLElement } | null {
  if (legs.length === 0) return null
  const segs: TripTimelineSeg[] = []
  for (const leg of legs) {
    const flight = flightById.get(leg.flight)
    if (!flight) return null
    const ends = flightSegmentEndpointsMs(flight)
    if (!ends) return null
    segs.push({ leg, flight, depMs: ends.depMs, arrMs: ends.arrMs })
  }
  const t0 = segs[0]!.depMs
  const t1 = segs[segs.length - 1]!.arrMs
  const span = t1 - t0
  if (!(span > 0)) return null

  const root = document.createElement("div")
  root.className = "trip-timeline"
  const ariaBits = segs.map((s, i) => `Leg ${i + 1}: ${s.flight.origin} to ${s.flight.destination}, ${fmtDur(s.flight.duration)}`).join(". ")
  root.setAttribute("role", "group")
  root.setAttribute("aria-label", `${legs.length} flight segment${legs.length === 1 ? "" : "s"}. ${ariaBits}`)

  const stack = document.createElement("div")
  stack.className = "trip-bar-stack"

  const above = document.createElement("div")
  above.className = "trip-bar-markers trip-bar-markers-above"
  above.setAttribute("aria-hidden", "true")

  segs.forEach((s, i) => {
    const depPct = pctOnSpan(s.depMs, t0, span)
    const mk = document.createElement("div")
    mk.className = `trip-bar-marker ${markerAnchorClass(depPct)}`
    mk.style.left = `${depPct}%`
    const prevIso = i === 0 ? null : flightArrDateIso(segs[i - 1]!.flight)
    const dt = tripMarkerDatetimeHtml(flightDepDateIso(s.flight), s.flight.departure_time, prevIso)
    mk.innerHTML = i === 0 ? `<span class="trip-bar-marker-kicker">${escapeHtml("Depart")}</span>${dt}` : dt
    above.appendChild(mk)
  })

  const trackWrap = document.createElement("div")
  trackWrap.className = "trip-bar-track-wrap"

  const track = document.createElement("div")
  track.className = "trip-bar-track"

  for (const pct of layoverCalendarDividerPcts(segs, t0, span)) {
    const div = document.createElement("div")
    div.className = "trip-bar-layover-day-divider"
    div.style.left = `${pct}%`
    div.setAttribute("aria-hidden", "true")
    div.title = "Calendar day change during layover"
    track.appendChild(div)
  }

  segs.forEach((s, index) => {
    const leftPct = pctOnSpan(s.depMs, t0, span)
    const arrPct = pctOnSpan(s.arrMs, t0, span)
    const widthPct = Math.max(arrPct - leftPct, 0.35)
    const seg = document.createElement("div")
    seg.className = "trip-bar-seg"
    seg.style.left = `${leftPct}%`
    seg.style.width = `${widthPct}%`
    seg.style.background = segmentHueCss(index)
    const depDateStr = fmtEndpointDate(s.flight.departure_date)
    const arrDateStr = fmtEndpointDate(s.flight.arrival_date ?? s.flight.departure_date)
    seg.title = `${s.flight.airline} ${s.flight.flight_number}: ${depDateStr} ${fmtClock(s.flight.departure_time)} → ${arrDateStr} ${fmtClock(s.flight.arrival_time)} (${fmtDur(s.flight.duration)})`

    const iataFrom = document.createElement("span")
    iataFrom.className = "trip-bar-seg-iata trip-bar-seg-iata-edge-start"
    iataFrom.setAttribute("aria-hidden", "true")
    iataFrom.textContent = s.flight.origin
    const iataTo = document.createElement("span")
    iataTo.className = "trip-bar-seg-iata trip-bar-seg-iata-edge-end"
    iataTo.setAttribute("aria-hidden", "true")
    iataTo.textContent = s.flight.destination
    seg.append(iataFrom, iataTo)

    track.appendChild(seg)
  })

  trackWrap.appendChild(track)

  const below = document.createElement("div")
  below.className = "trip-bar-markers trip-bar-markers-below"
  below.setAttribute("aria-hidden", "true")

  segs.forEach((s, i) => {
    const arrPct = pctOnSpan(s.arrMs, t0, span)
    const mk = document.createElement("div")
    mk.className = `trip-bar-marker ${markerAnchorClass(arrPct)}`
    mk.style.left = `${arrPct}%`
    const isLast = i === segs.length - 1
    const prevIso = flightDepDateIso(s.flight)
    const dt = tripMarkerDatetimeHtml(flightArrDateIso(s.flight), s.flight.arrival_time, prevIso)
    mk.innerHTML = isLast ? `${dt}<span class="trip-bar-marker-kicker">${escapeHtml("Arrive")}</span>` : dt
    below.appendChild(mk)
  })

  const foot = document.createElement("div")
  foot.className = "trip-bar-foot"
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!
    const leftPct = pctOnSpan(s.depMs, t0, span)
    const arrPct = pctOnSpan(s.arrMs, t0, span)
    const widthPct = Math.max(arrPct - leftPct, 0.35)
    const slot = document.createElement("div")
    slot.className = "trip-bar-foot-slot"
    slot.style.left = `${leftPct}%`
    slot.style.width = `${widthPct}%`
    slot.innerHTML = `<span class="trip-bar-foot-route">${escapeHtml(`${s.flight.origin}→${s.flight.destination}`)}</span>
      <span class="trip-bar-foot-text">${escapeHtml(`${s.flight.airline} ${s.flight.flight_number}`)} · ${escapeHtml(fmtDur(s.flight.duration))}</span>`
    if (s.leg.connection_time != null && i < segs.length - 1) {
      const lay = document.createElement("span")
      lay.className = "trip-bar-foot-layover"
      lay.textContent = `Layover ${s.leg.connection_time} min`
      slot.appendChild(lay)
    }
    foot.appendChild(slot)
  }

  stack.append(above, trackWrap, below, foot)
  root.appendChild(stack)
  return { root }
}

function renderLegItem(leg: UiLeg, flight: UiFlight | undefined): HTMLLIElement {
  const li = document.createElement("li")
  li.className = "leg-item"

  if (!flight) {
    const miss = document.createElement("div")
    miss.className = "leg-missing"
    miss.textContent = `Flight id ${leg.flight} (segment ${leg.order + 1}) — record missing`
    li.appendChild(miss)
    if (leg.connection_time != null) {
      li.appendChild(layoverEl(leg.connection_time))
    }
    return li
  }

  const main = document.createElement("div")
  main.className = "leg-main"

  const airline = document.createElement("span")
  airline.className = "leg-airline"
  airline.textContent = flight.airline

  const fn = document.createElement("span")
  fn.className = "leg-fn"
  fn.textContent = flight.flight_number

  const route = document.createElement("span")
  route.className = "leg-route"
  route.textContent = `${flight.origin} ${flight.departure_time} → ${flight.destination} ${flight.arrival_time}`

  const meta = document.createElement("span")
  meta.className = "leg-meta"
  meta.textContent = `${fmtDateShort(flight.departure_date)} · ${fmtDur(flight.duration)}`

  main.append(airline, document.createTextNode(" "), fn, route, meta)
  li.appendChild(main)

  if (leg.connection_time != null) {
    li.appendChild(layoverEl(leg.connection_time))
  }

  return li
}

function layoverEl(minutes: number): HTMLDivElement {
  const d = document.createElement("div")
  d.className = "leg-layover"
  d.textContent = `Layover ${minutes} min`
  return d
}

function renderDealChip(deal: UiDeal): HTMLDivElement {
  const el = document.createElement("div")
  el.className = "deal-chip"

  const prov = document.createElement("span")
  prov.className = "deal-chip-provider"
  prov.textContent = deal.provider
  prov.title = deal.provider

  const price = document.createElement("span")
  price.className = "deal-chip-price"
  price.textContent = fmtMoney(deal.price, "EUR")

  const link = document.createElement("a")
  link.className = "deal-chip-link"
  link.href = deal.link
  link.target = "_blank"
  link.rel = "noopener noreferrer"
  link.textContent = "Book"
  link.title = `Book with ${deal.provider} for ${fmtMoney(deal.price, "EUR")}`

  el.append(prov, price, link)
  return el
}

function shortId(id: string): string {
  const s = String(id)
  return s.length <= 14 ? s : `${s.slice(0, 12)}…`
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
