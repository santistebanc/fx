import { inferArrivalDateIsoFromPortalClocks, parseClockMinutesFromPortal } from "../../flightScrapeDates"

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
const overviewEl = document.querySelector<HTMLParagraphElement>("#results-overview")
const ph = qs<HTMLParagraphElement>("#results-placeholder")
const errEl = qs<HTMLParagraphElement>("#results-error")
const statusEl = qs<HTMLParagraphElement>("#results-status")
const resultsPanel = qs<HTMLElement>("#results-panel")

const LOADING_HINT = "Searching… Live requests can take up to a minute — hang tight."
const IDLE_PLACEHOLDER = "Run a search to load results."

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
  const total = Math.max(0, Math.round(Number(minutes)))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h <= 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Parse date+time as UTC for legacy fallback only (scraped clocks are local; prefer duration axis). */
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
 * Fallback timeline endpoints when duration/layover chaining cannot be used.
 * Scraped times are local at each airport; UTC parsing here is only a coarse fallback.
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
  if (overviewEl) {
    overviewEl.replaceChildren()
    overviewEl.classList.add("hidden")
    overviewEl.hidden = true
  }
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

  let currentItems = [...items]
  let page = 0
  let pageSize = Number(select.value)

  function totalPages() {
    const n = currentItems.length
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
    const slice = currentItems.slice(start, start + pageSize)
    for (const item of slice) {
      listHost.appendChild(renderItem(item))
    }

    const n = currentItems.length
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

  return {
    setItems(nextItems: readonly T[], opts?: { resetPage?: boolean }) {
      currentItems = [...nextItems]
      if (opts?.resetPage !== false) page = 0
      draw()
    },
  }
}

/** Marker stagger + IATA overlap merge flushes defer past this deadline during morph / carousel prep. */
let tripBarMorphEffectsSuppressedUntil = 0

const TRIP_BAR_SEGMENT_MORPH_MS = 560
const TRIP_BAR_IATA_LEAVE_MS = 165

function tripBarIataLeaveMs(): number {
  return tripBarMorphMotionEnabled() ? TRIP_BAR_IATA_LEAVE_MS : 0
}

function tripBarMorphMotionEnabled(): boolean {
  return typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Per-segment geometry relative to its own track (outbound + inbound bars in DOM order). */
function collectTripBarSegmentLayouts(panel: HTMLElement): { leftPct: number; widthPct: number }[] {
  const out: { leftPct: number; widthPct: number }[] = []
  for (const node of panel.querySelectorAll(".trip-detail .trip-timeline .trip-bar-seg")) {
    const el = node as HTMLElement
    const track = el.closest(".trip-bar-track")
    if (!track) continue
    const tr = track.getBoundingClientRect()
    const sr = el.getBoundingClientRect()
    if (!(tr.width > 0.5)) continue
    out.push({
      leftPct: ((sr.left - tr.left) / tr.width) * 100,
      widthPct: (sr.width / tr.width) * 100,
    })
  }
  return out
}

/**
 * Tween coloured segment percentage left/width from the previous trip (smooth slide + grow/shrink).
 * IATA labels are hidden for the morph and cross-faded in after layout (see finalizeTripBarMorph).
 */
function morphTripBarSegmentsFromPrevious(
  previous: readonly { leftPct: number; widthPct: number }[],
  newSegs: HTMLElement[],
  browserPanel: HTMLElement,
): void {
  if (!tripBarMorphMotionEnabled() || previous.length === 0 || newSegs.length === 0) return

  const nMatched = Math.min(previous.length, newSegs.length)
  const dur = `${TRIP_BAR_SEGMENT_MORPH_MS}ms cubic-bezier(0.22, 0.95, 0.34, 1)`

  for (const el of newSegs) {
    el.classList.remove("trip-bar-seg--enter")
    el.style.animation = "none"
    el.classList.add("trip-bar-seg--morphing")
  }

  for (let i = 0; i < nMatched; i++) {
    const el = newSegs[i]!
    const targetL = el.dataset.barLeftPct
    const targetW = el.dataset.barWidthPct
    if (!targetL || !targetW) continue
    const pv = previous[i]!
    el.style.transition = "none"
    el.style.left = `${pv.leftPct}%`
    el.style.width = `${pv.widthPct}%`
  }
  for (let i = nMatched; i < newSegs.length; i++) {
    const el = newSegs[i]!
    const targetL = el.dataset.barLeftPct
    const targetW = el.dataset.barWidthPct
    if (!targetL || !targetW) continue
    const tw = parseFloat(targetW)
    const skinny = `${Math.min(5, Math.max(0.35, tw * 0.06))}%`
    el.style.transition = "none"
    el.style.left = `${targetL}%`
    el.style.width = skinny
  }
  if (newSegs[0]) newSegs[0].offsetHeight

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      for (let i = 0; i < nMatched; i++) {
        const el = newSegs[i]!
        const targetL = el.dataset.barLeftPct
        const targetW = el.dataset.barWidthPct
        if (!targetL || !targetW) continue
        el.style.transition = `left ${dur}, width ${dur}`
        el.style.left = `${targetL}%`
        el.style.width = `${targetW}%`
      }
      for (let i = nMatched; i < newSegs.length; i++) {
        const el = newSegs[i]!
        const targetL = el.dataset.barLeftPct
        const targetW = el.dataset.barWidthPct
        if (!targetL || !targetW) continue
        el.style.transition = `width ${dur}`
        el.style.left = `${targetL}%`
        el.style.width = `${targetW}%`
      }
    })
  })

  window.setTimeout(() => {
    for (const el of newSegs) {
      el.classList.remove("trip-bar-seg--morphing")
      const l = el.dataset.barLeftPct
      const w = el.dataset.barWidthPct
      if (l != null && w != null) {
        el.style.transition = ""
        el.style.left = `${l}%`
        el.style.width = `${w}%`
      }
    }
    if (browserPanel.isConnected) finalizeTripBarMorph(browserPanel)
  }, TRIP_BAR_SEGMENT_MORPH_MS + 90)
}

/** Icon for cohort extent toggle (expand vs crop); reused by trip nav control. */
function svgFullExtentToggleIcon(fullExtentActive: boolean): string {
  if (fullExtentActive) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="square" aria-hidden="true"><path d="M9 9H4V4h5M15 9h5V4h-5M9 15H4v5h5M15 15h5v-5h-5"/></svg>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="square" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3v6h-6M3 21v-6h6"/></svg>`
}

function paintFullExtentToggleButton(btn: HTMLButtonElement, fullExtent: boolean): void {
  btn.setAttribute("aria-pressed", fullExtent ? "true" : "false")
  const labelText = fullExtent ? "Full data" : "Leader caps"
  btn.innerHTML = `${svgFullExtentToggleIcon(fullExtent)}<span class="trip-browser-full-extent__label">${labelText}</span>`
  btn.title = fullExtent
    ? "Using full search bounds for filters and sliders. Click for leader-reference caps."
    : "Leader caps on stat sliders; ranking uses filtered cohort. Click for full search bounds on all sliders and ranking vs whole result set."
}

/** One trip at a time in weighted-rank order: index 0 = best; ←/→ only. */
function mountRankedTripBrowser(
  navParent: HTMLElement,
  panelParent: HTMLElement,
  options: {
    label?: string
    initialIds: readonly string[]
    renderCard: (tripId: string) => HTMLElement
    onSelectionChange?: (tripId: string | null, tripIndex: number, tripCount: number) => void
    /** Appended after ← / info / → (e.g. global cohort toggle). */
    trailingNavControls?: HTMLElement[]
  },
): {
  setRankedTrips: (ids: readonly string[], opts?: { resetToBest?: boolean }) => void
} {
  const label = options.label ?? "Ranked trips"

  panelParent.classList.add("trip-browser-panel", "results-trip-panel")
  panelParent.tabIndex = 0
  panelParent.setAttribute("aria-label", label)

  const nav = document.createElement("div")
  nav.className = "trip-browser-nav"

  const prev = document.createElement("button")
  prev.type = "button"
  prev.className = "pager-btn trip-browser-arrow"
  prev.textContent = "←"
  prev.setAttribute("aria-label", "Previous — more preferred trip (better rank)")

  const next = document.createElement("button")
  next.type = "button"
  next.className = "pager-btn trip-browser-arrow"
  next.textContent = "→"
  next.setAttribute("aria-label", "Next — less preferred trip (worse rank)")

  const info = document.createElement("p")
  info.className = "trip-browser-info"
  info.setAttribute("role", "status")

  nav.append(prev, info, next, ...(options.trailingNavControls ?? []))
  navParent.replaceChildren(nav)

  let sortedIds: string[] = [...options.initialIds]
  let idx = 0

  function draw(): void {
    const prevLayouts =
      panelParent.querySelector(".trip-detail .trip-timeline .trip-bar-seg") != null
        ? collectTripBarSegmentLayouts(panelParent)
        : []

    /** Outgoing card had coloured bar IATA spans (excluding first paint empty panel). */
    const outgoingHadIata =
      prevLayouts.length > 0 &&
      panelParent.querySelector(".trip-detail .trip-timeline .trip-bar-seg-iata") != null

    const segmentMorph = tripBarMorphMotionEnabled() && prevLayouts.length > 0
    const leaveMs =
      sortedIds.length > 0 && prevLayouts.length > 0 && outgoingHadIata ? tripBarIataLeaveMs() : 0

    const mountTrip = (): void => {
      const n = sortedIds.length

      panelParent.replaceChildren()

      if (n === 0) {
        tripBarMorphEffectsSuppressedUntil = 0
        info.textContent = "No trips to show"
        prev.disabled = true
        next.disabled = true
        const miss = document.createElement("p")
        miss.className = "trip-browser-empty"
        miss.textContent = "No itinerary trips in this result set."
        panelParent.appendChild(miss)
        options.onSelectionChange?.(null, 0, 0)
        return
      }

      if (idx >= n) idx = n - 1
      if (idx < 0) idx = 0
      const tripId = sortedIds[idx]!

      if (segmentMorph) {
        tripBarMorphEffectsSuppressedUntil = performance.now() + TRIP_BAR_SEGMENT_MORPH_MS + 140
      } else {
        tripBarMorphEffectsSuppressedUntil = 0
      }

      info.textContent = `Trip ${idx + 1} of ${n}`
      prev.disabled = idx <= 0
      next.disabled = idx >= n - 1
      panelParent.appendChild(options.renderCard(tripId))
      options.onSelectionChange?.(tripId, idx, n)

      /** Avoid sliding IATA with segment tween: hide until merge + fade-in passes. */
      const hideIataUntilFade = segmentMorph || outgoingHadIata

      if (hideIataUntilFade) hideTripBarIataForCarouselSwap(panelParent)

      if (segmentMorph) {
        const newSegs = [...panelParent.querySelectorAll(".trip-detail .trip-timeline .trip-bar-seg")] as HTMLElement[]
        if (newSegs.length > 0) {
          morphTripBarSegmentsFromPrevious(prevLayouts, newSegs, panelParent)
        } else if (hideIataUntilFade) {
          finalizeTripBarMorph(panelParent)
        }
      } else if (hideIataUntilFade) {
        finalizeTripBarMorph(panelParent)
      }
    }

    if (leaveMs > 0) {
      const outgoingSpans = [...panelParent.querySelectorAll(".trip-detail .trip-bar-seg-iata")] as HTMLElement[]
      if (outgoingSpans.length === 0) {
        mountTrip()
        return
      }
      for (const sp of outgoingSpans) sp.classList.add("trip-bar-seg-iata--xfade-leave")
      void panelParent.offsetHeight
      window.setTimeout(mountTrip, leaveMs)
      return
    }

    mountTrip()
  }

  prev.addEventListener("click", () => {
    idx = Math.max(0, idx - 1)
    draw()
  })
  next.addEventListener("click", () => {
    idx = Math.min(sortedIds.length - 1, idx + 1)
    draw()
  })

  panelParent.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault()
      prev.click()
    } else if (e.key === "ArrowRight") {
      e.preventDefault()
      next.click()
    }
  })

  draw()

  return {
    setRankedTrips(ids: readonly string[], opts?: { resetToBest?: boolean }) {
      sortedIds = [...ids]
      if (opts?.resetToBest !== false) idx = 0
      else if (idx >= sortedIds.length) idx = Math.max(0, sortedIds.length - 1)
      draw()
    },
  }
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

/** Match scrapers’ trip hashing: multiset of itinerary flight ids (sorted lexicographically). */
function tripFlightMultisetSignature(legsForTrip: readonly UiLeg[]): string {
  const ids = legsForTrip.map((l) => l.flight).slice().sort((a, b) => a.localeCompare(b))
  return ids.join("|")
}

/** Key one physical segment independently of Kiwi vs Skyscanner flight id strings. */
function flightLogicalKey(f: UiFlight): string {
  const fn = f.flight_number.replace(/\s+/g, "").toUpperCase()
  return `${f.origin}|${f.destination}|${f.departure_date}|${f.departure_time}|${fn}`
}

/**
 * Unify itineraries across sources after `mergeSuccessfulSources`: merge flights that denote the same
 * segment, then remap trip ids that share the same multiset of canonical flight ids so all matching
 * deals land under one carousel trip key.
 */
function unifyMergedItineraries(merged: {
  deals: UiDeal[]
  flights: UiFlight[]
  legs: UiLeg[]
  maxTimeSpentMs: number
}): {
  deals: UiDeal[]
  flights: UiFlight[]
  legs: UiLeg[]
  maxTimeSpentMs: number
} {
  const { maxTimeSpentMs } = merged
  if (merged.flights.length === 0 || merged.legs.length === 0) return merged

  const logicalToRepId = new Map<string, string>()
  for (const f of merged.flights) {
    const k = flightLogicalKey(f)
    const cur = logicalToRepId.get(k)
    if (cur == null || f.id.localeCompare(cur) < 0) logicalToRepId.set(k, f.id)
  }

  const flightRemap = new Map<string, string>()
  for (const f of merged.flights) {
    flightRemap.set(f.id, logicalToRepId.get(flightLogicalKey(f))!)
  }

  const repFlight = new Map<string, UiFlight>()
  for (const f of merged.flights) {
    const rep = flightRemap.get(f.id)!
    const existing = repFlight.get(rep)
    if (!existing) {
      repFlight.set(rep, f.id === rep ? f : { ...f, id: rep })
    } else if (f.id === rep) {
      repFlight.set(rep, f)
    }
  }

  const legsFlightRewritten: UiLeg[] = merged.legs.map((leg) => ({
    ...leg,
    flight: flightRemap.get(leg.flight) ?? leg.flight,
  }))

  const legsByTrip = new Map<string, UiLeg[]>()
  for (const leg of legsFlightRewritten) {
    let list = legsByTrip.get(leg.trip)
    if (!list) {
      list = []
      legsByTrip.set(leg.trip, list)
    }
    list.push(leg)
  }

  function multisetSigForTripId(tripId: string): string | null {
    const ls = legsByTrip.get(tripId)
    if (!ls || ls.length === 0) return null
    return tripFlightMultisetSignature(ls)
  }

  const allTripIds = new Set<string>()
  for (const d of merged.deals) allTripIds.add(d.trip)
  for (const l of legsFlightRewritten) allTripIds.add(l.trip)

  const sigToTrips = new Map<string, string[]>()
  for (const tid of allTripIds) {
    const sig = multisetSigForTripId(tid)
    if (sig == null) continue
    let group = sigToTrips.get(sig)
    if (!group) {
      group = []
      sigToTrips.set(sig, group)
    }
    group.push(tid)
  }

  const tripRemap = new Map<string, string>()
  for (const members of sigToTrips.values()) {
    let canon = members[0]!
    for (let i = 1; i < members.length; i++) {
      const t = members[i]!
      if (t.localeCompare(canon) < 0) canon = t
    }
    for (const tid of members) tripRemap.set(tid, canon)
  }

  const remapTrip = (t: string): string => tripRemap.get(t) ?? t

  const dealsOut = merged.deals.map((d) => ({ ...d, trip: remapTrip(d.trip) }))

  const legsOutDraft: UiLeg[] = legsFlightRewritten.map((leg) => {
    const trip = remapTrip(leg.trip)
    const dir = leg.inbound ? "inbound" : "outbound"
    return {
      ...leg,
      trip,
      id: `${trip}_${dir}_${leg.flight}`,
    }
  })

  const legsDedup = new Map<string, UiLeg>()
  for (const leg of legsOutDraft) {
    legsDedup.set(leg.id, leg)
  }

  const flightsOut = [...repFlight.values()].sort((a, b) => a.id.localeCompare(b.id))

  return {
    deals: dealsOut,
    flights: flightsOut,
    legs: [...legsDedup.values()],
    maxTimeSpentMs,
  }
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

  const merged = unifyMergedItineraries(mergeSuccessfulSources(successes))

  const announcements = []
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
    const tripIds = [...dealsByTrip.keys()]
    const minuteBarLead = computeMinuteBarLeadBaselines({
      tripIds,
      allLegs: merged.legs,
      flightById,
      dealsByTrip,
    })
    const featByTrip = new Map<string, TripScoreFeat>()
    for (const tid of tripIds) {
      const dl = dealsByTrip.get(tid)
      if (!dl) continue
      const fx = buildTripScoreFeat(tid, merged.legs, flightById, dl)
      if (fx) featByTrip.set(tid, fx)
    }

    let dualExtents = computeTripStatDualRanges(featByTrip, dealsByTrip, TRIP_RANK_WEIGHTS)
    let statCeilings: TripStatMaxCeilings = defaultStatCeilingsFromRanges(dualExtents.bounded)

    const rankUi = {
      filteredFeats: filterFeatMapByStatCeilings(featByTrip, statCeilings),
    }

    let carouselHandle: { setRankedTrips: (ids: readonly string[], opts?: { resetToBest?: boolean }) => void }

    let statSliderApi: {
      wrap: HTMLElement
      refreshDual: (d: TripStatDualRanges) => void
      setSelectedFeat: (f: TripScoreFeat | null) => void
      getExtentFull: () => boolean
      setExtentFull: (v: boolean) => void
    }

    function applyTripFilters(resetToBest: boolean, recomputeDualExtents: boolean): void {
      rankUi.filteredFeats = filterFeatMapByStatCeilings(featByTrip, statCeilings)
      const rangeRows = statSliderApi.getExtentFull()
        ? [...featByTrip.values()]
        : [...rankUi.filteredFeats.values()]
      const filteredIds = tripIds.filter((id) => rankUi.filteredFeats.has(id))
      const sorted = sortTripIdsByWeightedScore(filteredIds, featByTrip, dealsByTrip, TRIP_RANK_WEIGHTS, rangeRows)
      carouselHandle.setRankedTrips(sorted, { resetToBest })
      if (recomputeDualExtents) {
        dualExtents = computeTripStatDualRanges(featByTrip, dealsByTrip, TRIP_RANK_WEIGHTS)
        statSliderApi.refreshDual(dualExtents)
      }
    }

    const resultsLayout = document.createElement("div")
    resultsLayout.className = "results-layout"

    const overallSection = document.createElement("section")
    overallSection.className = "results-overall"

    const navHost = document.createElement("div")
    navHost.className = "results-overall-nav"

    const indicatorsHost = document.createElement("div")
    indicatorsHost.className = "results-overall-indicators"

    overallSection.append(navHost, indicatorsHost)

    const tripSection = document.createElement("section")
    tripSection.className = "results-trip-detail"

    resultsLayout.append(overallSection, tripSection)
    bodyCol.appendChild(resultsLayout)

    statSliderApi = buildTripStatMaxControls({
      featByTrip,
      dual: dualExtents,
      initialCeilings: statCeilings,
      onCeilingsChange(c) {
        statCeilings = c
        applyTripFilters(true, false)
      },
    })
    indicatorsHost.appendChild(statSliderApi.wrap)

    const fullExtentBtn = document.createElement("button")
    fullExtentBtn.type = "button"
    fullExtentBtn.className = "pager-btn trip-browser-full-extent"
    paintFullExtentToggleButton(fullExtentBtn, statSliderApi.getExtentFull())
    fullExtentBtn.addEventListener("click", () => {
      const next = !statSliderApi.getExtentFull()
      statSliderApi.setExtentFull(next)
      paintFullExtentToggleButton(fullExtentBtn, next)
      applyTripFilters(true, false)
    })

    carouselHandle = mountRankedTripBrowser(navHost, tripSection, {
      label: "Ranked itineraries",
      trailingNavControls: [fullExtentBtn],
      initialIds: sortTripIdsByWeightedScore(
        tripIds.filter((id) => rankUi.filteredFeats.has(id)),
        featByTrip,
        dealsByTrip,
        TRIP_RANK_WEIGHTS,
        statSliderApi.getExtentFull() ? [...featByTrip.values()] : [...rankUi.filteredFeats.values()],
      ),
      onSelectionChange(tripId) {
        statSliderApi.setSelectedFeat(tripId ? featByTrip.get(tripId) ?? null : null)
      },
      renderCard: (tripId: string) =>
        renderTripDetailFlat(tripId, merged.legs, flightById, dealsByTrip.get(tripId), {
          minuteBarOutboundLeadBaseline: minuteBarLead.outbound,
          minuteBarInboundLeadBaseline: minuteBarLead.inbound,
        }),
    })
  }

  wrap.append(bodyCol)
  resultsRoot.appendChild(wrap)

  if (statusEl) {
    statusEl.textContent = announcements.length ? announcements.join(". ") + "." : ""
  }
}

function minDealPrice(deals: readonly UiDeal[] | undefined): number {
  if (!deals?.length) return Number.POSITIVE_INFINITY
  return Math.min(...deals.map((d) => d.price))
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

/** Same partitioning as itinerary cards — used for scoring and rendering. */
function inferTripDirections(
  tripId: string,
  allLegs: readonly UiLeg[],
  flightById: Map<string, UiFlight>,
  dealList: readonly UiDeal[],
): { outbound: UiLeg[]; inbound: UiLeg[] } {
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
  return { outbound, inbound }
}

type TripScoreFeat = {
  tripId: string
  priceCents: number
  /** Σ flight.duration + Σ leg.connection_time (outbound + inbound), minutes from itinerary graph only. */
  scheduledTripMin: number
  /** Σ layover between legs (connection_time only), outbound + inbound. */
  totalConnectionMin: number
  stopsTotal: number
  layoverPain: number
}

type TripRankWeights = { price: number; duration: number; stops: number; layover: number }

/**
 * Developer-tunable fare-led ranking weights (no UI). Higher values stress that axis in the sort —
 * see `sortTripIdsByWeightedScore` / `priceLedRankScoreCents`.
 */
const TRIP_RANK_WEIGHTS: TripRankWeights = { price: 80, duration: 60, stops: 35, layover: 30 }

function layoverPenaltyMins(ct: number): number {
  if (!(ct >= 0) || Number.isNaN(ct)) return 0
  if (ct < 45) return (45 - ct) * 2.8
  if (ct <= 180) return 0
  return (ct - 180) * 0.35
}

function directionalBlockTotals(legs: readonly UiLeg[], flightById: Map<string, UiFlight>): {
  flyMin: number
  connMin: number
  layoverPain: number
  stopsHint: number
} {
  if (legs.length === 0) return { flyMin: 0, connMin: 0, layoverPain: 0, stopsHint: 0 }
  const sorted = [...legs].sort((a, b) => a.order - b.order)
  let flyMin = 0
  let connMin = 0
  let layoverPain = 0
  for (let i = 0; i < sorted.length; i++) {
    const leg = sorted[i]!
    const fl = flightById.get(leg.flight)
    const dur = fl?.duration
    if (dur != null && Number.isFinite(dur) && dur > 0) flyMin += dur
    if (i < sorted.length - 1) {
      const c = leg.connection_time
      if (c != null && Number.isFinite(c) && c >= 0) {
        connMin += c
        layoverPain += layoverPenaltyMins(c)
      }
    }
  }
  const stopsHint = Math.max(0, sorted.length - 1)
  return { flyMin, connMin, layoverPain, stopsHint }
}

function buildTripScoreFeat(
  tripId: string,
  allLegs: readonly UiLeg[],
  flightById: Map<string, UiFlight>,
  dealsForTrip: readonly UiDeal[],
): TripScoreFeat | null {
  if (dealsForTrip.length === 0) return null
  const { outbound, inbound } = inferTripDirections(tripId, allLegs, flightById, dealsForTrip)
  const ob = directionalBlockTotals(outbound, flightById)
  const ib = directionalBlockTotals(inbound, flightById)
  const scheduledTripMin = Math.max(ob.flyMin + ob.connMin + ib.flyMin + ib.connMin, 1)

  const priceCents = minDealPrice(dealsForTrip)
  if (!Number.isFinite(priceCents) || priceCents === Number.POSITIVE_INFINITY) return null

  return {
    tripId,
    priceCents,
    scheduledTripMin,
    totalConnectionMin: Math.max(ob.connMin + ib.connMin, 0),
    stopsTotal: ob.stopsHint + ib.stopsHint,
    layoverPain: ob.layoverPain + ib.layoverPain,
  }
}

function finiteMinMax(vals: readonly number[]): { lo: number; hi: number } | null {
  const f = vals.filter((x) => Number.isFinite(x))
  if (f.length === 0) return null
  return { lo: Math.min(...f), hi: Math.max(...f) }
}

/** Stats matched to max sliders and carousel filter clauses. */
const STAT_FILTER_AXES = ["price", "scheduled", "wait", "connections"] as const
type StatFilterAxisKey = (typeof STAT_FILTER_AXES)[number]

/** Inclusive ceiling per statistic — trips with any value strictly above are excluded from the carousel. */
type TripStatMaxCeilings = Record<StatFilterAxisKey, number>

function statMetricForMaxFilter(axis: StatFilterAxisKey, f: TripScoreFeat): number {
  switch (axis) {
    case "price":
      return f.priceCents
    case "scheduled":
      return f.scheduledTripMin
    case "wait":
      return f.totalConnectionMin
    case "connections":
      return f.stopsTotal
  }
}

function statAxisMinMaxFromFeats(
  featByTrip: Map<string, TripScoreFeat>,
): Record<StatFilterAxisKey, { lo: number; hi: number } | null> {
  const vals = [...featByTrip.values()]
  if (vals.length === 0) {
    return { price: null, scheduled: null, wait: null, connections: null }
  }
  return {
    price: finiteMinMax(vals.map((x) => x.priceCents)),
    scheduled: finiteMinMax(vals.map((x) => x.scheduledTripMin)),
    wait: finiteMinMax(vals.map((x) => x.totalConnectionMin)),
    connections: finiteMinMax(vals.map((x) => x.stopsTotal)),
  }
}

function defaultStatCeilingsFromRanges(
  ranges: Record<StatFilterAxisKey, { lo: number; hi: number } | null>,
): TripStatMaxCeilings {
  const pick = (axis: StatFilterAxisKey): number => ranges[axis]?.hi ?? 0
  return {
    price: pick("price"),
    scheduled: pick("scheduled"),
    wait: pick("wait"),
    connections: pick("connections"),
  }
}

/** Keep trips whose feats exist and satisfy every ceiling. */
function filterFeatMapByStatCeilings(
  featByTrip: Map<string, TripScoreFeat>,
  ceilings: TripStatMaxCeilings,
): Map<string, TripScoreFeat> {
  const out = new Map<string, TripScoreFeat>()
  for (const [id, f] of featByTrip) {
    let ok = true
    for (const axis of STAT_FILTER_AXES) {
      if (statMetricForMaxFilter(axis, f) > ceilings[axis]) {
        ok = false
        break
      }
    }
    if (ok) out.set(id, f)
  }
  return out
}

function normBand(v: number, lo: number, hi: number): number {
  if (!(hi > lo)) return 0.5
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
}

/**
 * Fare stays the backbone (¢); itinerary pain is layered on top. Sliders tilt how strongly those extras
 * substitute for paying more — higher “cheaper fare” weight shrinks itinerary penalty vs same cash spread.
 */
const PENALTY_BUDGET_CENTS = 30_000

/** 0–1 “bad itinerary” blend for duration / stops / layover-only (excluding price). */
function tripOpsPain01(
  f: TripScoreFeat,
  w: TripRankWeights,
  ranges: { dur: { lo: number; hi: number }; stops: { lo: number; hi: number }; lay: { lo: number; hi: number } },
): number {
  const Wops = w.duration + w.stops + w.layover
  if (!(Wops > 0)) return 0
  const nD = normBand(f.scheduledTripMin, ranges.dur.lo, ranges.dur.hi)
  const nSt = normBand(f.stopsTotal, ranges.stops.lo, ranges.stops.hi)
  const nL = normBand(f.layoverPain, ranges.lay.lo, ranges.lay.hi)
  return (w.duration / Wops) * nD + (w.stops / Wops) * nSt + (w.layover / Wops) * nL
}

/** How much itinerary penalties count vs leaning on nominal fare alone (still never subtracts cash). */
function penaltyEmphasis01(w: TripRankWeights): number {
  const Wops = w.duration + w.stops + w.layover
  if (!(Wops > 0)) return 0
  return Wops / (w.price + Wops + 1e-12)
}

function priceLedRankScoreCents(
  f: TripScoreFeat,
  w: TripRankWeights,
  ranges: {
    dur: { lo: number; hi: number }
    stops: { lo: number; hi: number }
    lay: { lo: number; hi: number }
  },
): number {
  const pain = tripOpsPain01(f, w, ranges)
  const emph = penaltyEmphasis01(w)
  return f.priceCents + PENALTY_BUDGET_CENTS * pain * emph
}

/** Lower effective sort-cost is better — fare + blended itinerary surcharge. Stable tie-break by price then id. */
function sortTripIdsByWeightedScore(
  tripIds: readonly string[],
  featByTrip: Map<string, TripScoreFeat>,
  dealsByTrip: Map<string, UiDeal[]>,
  w: TripRankWeights,
  /** Optional cohort for normalizing durations/stops/layover bands (defaults to all feats). */
  rangeRows?: readonly TripScoreFeat[],
): string[] {
  const rows = rangeRows ?? [...featByTrip.values()]
  const dR = finiteMinMax(rows.map((r) => r.scheduledTripMin))
  const sR = finiteMinMax(rows.map((r) => r.stopsTotal))
  const lR = finiteMinMax(rows.map((r) => r.layoverPain))
  const wSum = w.price + w.duration + w.stops + w.layover

  type Key = { ok: boolean; score: number; price: number; id: string }
  function keyFor(id: string): Key {
    const price = minDealPrice(dealsByTrip.get(id))
    const f = featByTrip.get(id)
    if (!f || !dR || !sR || !lR || !Number.isFinite(f.priceCents) || !(wSum > 0)) {
      return { ok: false, score: Number.POSITIVE_INFINITY, price, id }
    }
    const ranges = { dur: dR, stops: sR, lay: lR }
    const score = priceLedRankScoreCents(f, w, ranges)
    return { ok: true, score, price: f.priceCents, id }
  }

  return [...tripIds].sort((a, b) => {
    const ka = keyFor(a)
    const kb = keyFor(b)
    if (ka.ok !== kb.ok) return ka.ok ? -1 : 1
    if (ka.ok && kb.ok && ka.score !== kb.score) return ka.score - kb.score
    if (ka.price !== kb.price) return ka.price - kb.price
    return String(a).localeCompare(String(b))
  })
}

type TripStatDualRanges = {
  /** Slider/track extents when not using full cohort (leader picks + max caps). */
  bounded: Record<StatFilterAxisKey, { lo: number; hi: number } | null>
  full: Record<StatFilterAxisKey, { lo: number; hi: number } | null>
}

/** Lexicographic-min trip under primary + tie-break columns (all ascending = lower is better). */
function pickTripBySortOrder<K extends Exclude<keyof TripScoreFeat, "tripId">>(
  rows: readonly TripScoreFeat[],
  keys: readonly K[],
): TripScoreFeat | null {
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => {
    for (const k of keys) {
      const va = a[k] as number
      const vb = b[k] as number
      if (va !== vb) return va - vb
    }
    return String(a.tripId).localeCompare(String(b.tripId))
  })
  return sorted[0] ?? null
}

/** Four orthogonal “bests”; bounded slider highs = max of each metric across those picks (los tied per sort). */
function computeBoundedRangesFromLeaderQuad(featByTrip: Map<string, TripScoreFeat>): Record<
  StatFilterAxisKey,
  { lo: number; hi: number } | null
> {
  const full = statAxisMinMaxFromFeats(featByTrip)
  const rows = [...featByTrip.values()]
  if (rows.length === 0) return full

  const kPrice = ["priceCents", "scheduledTripMin", "stopsTotal", "totalConnectionMin"] as const
  const kTravel = ["scheduledTripMin", "priceCents", "stopsTotal", "totalConnectionMin"] as const
  const kConn = ["stopsTotal", "priceCents", "scheduledTripMin", "totalConnectionMin"] as const
  const kLay = ["totalConnectionMin", "priceCents", "scheduledTripMin", "stopsTotal"] as const

  const picks = [
    pickTripBySortOrder(rows, kPrice),
    pickTripBySortOrder(rows, kTravel),
    pickTripBySortOrder(rows, kConn),
    pickTripBySortOrder(rows, kLay),
  ].filter((x): x is TripScoreFeat => x != null)

  const byId = new Map<string, TripScoreFeat>()
  for (const p of picks) byId.set(p.tripId, p)
  const leaders = [...byId.values()]

  const hiPrice = Math.max(...leaders.map((x) => x.priceCents))
  const hiSched = Math.max(...leaders.map((x) => x.scheduledTripMin))
  const hiWait = Math.max(...leaders.map((x) => x.totalConnectionMin))
  const hiStops = Math.max(...leaders.map((x) => x.stopsTotal))

  const axisHi = (fullAxis: { lo: number; hi: number } | null, hi: number): { lo: number; hi: number } | null => {
    if (!fullAxis) return null
    return { lo: fullAxis.lo, hi: Math.max(fullAxis.lo, hi) }
  }

  return {
    price: axisHi(full.price, hiPrice),
    scheduled: axisHi(full.scheduled, hiSched),
    wait: axisHi(full.wait, hiWait),
    connections: axisHi(full.connections, hiStops),
  }
}

function computeTripStatDualRanges(
  featByTrip: Map<string, TripScoreFeat>,
  _dealsByTrip: Map<string, UiDeal[]>,
  _weights: TripRankWeights,
): TripStatDualRanges {
  const full = statAxisMinMaxFromFeats(featByTrip)
  const bounded = featByTrip.size === 0 ? full : computeBoundedRangesFromLeaderQuad(featByTrip)
  return { bounded, full }
}

function sortedUniqueAxisValues(
  pool: Map<string, TripScoreFeat>,
  axis: StatFilterAxisKey,
  extent?: { lo: number; hi: number } | null,
): number[] {
  const vals = new Set<number>()
  for (const f of pool.values()) {
    const raw = statMetricForMaxFilter(axis, f)
    vals.add(Math.round(Number(raw)))
  }
  const sorted = [...vals].sort((a, b) => a - b)
  if (extent == null) return sorted
  return sorted.filter((v) => v >= extent.lo && v <= extent.hi)
}

/**
 * Snap toward the largest observed value still ≤ `target`, but if `target` is **below** the smallest
 * observed bucket, keep `target` so filters can sit between integer buckets when extent tightens.
 */
function snapCeilingToObservedAscending(sortedAsc: readonly number[], target: number): number {
  if (sortedAsc.length === 0) return target
  const lo = sortedAsc[0]!
  if (target < lo) return target
  const last = sortedAsc[sortedAsc.length - 1]!
  if (target >= last) return last
  let best = sortedAsc[0]!
  for (const x of sortedAsc) {
    if (x <= target) best = x
    else break
  }
  return best
}

/** Align WebKit track gradient (`--trip-stat-fill-pct`) with discrete thumb steps (indexes 0 … n−1). */
function setTripStatMaxDiscreteBarPct(trackEl: HTMLElement, idx: number, n: number): void {
  if (n <= 0) {
    trackEl.style.setProperty("--trip-stat-fill-pct", "0%")
    return
  }
  if (n === 1) {
    trackEl.style.setProperty("--trip-stat-fill-pct", "100%")
    return
  }
  const clamped = Math.max(0, Math.min(n - 1, idx))
  const pct = (clamped / (n - 1)) * 100
  trackEl.style.setProperty("--trip-stat-fill-pct", `${Math.max(0, Math.min(100, pct))}%`)
}

function buildTripStatMaxControls(opts: {
  featByTrip: Map<string, TripScoreFeat>
  dual: TripStatDualRanges
  initialCeilings: TripStatMaxCeilings
  onCeilingsChange: (c: TripStatMaxCeilings) => void
}): {
  wrap: HTMLElement
  refreshDual: (d: TripStatDualRanges) => void
  setSelectedFeat: (f: TripScoreFeat | null) => void
  getExtentFull: () => boolean
  setExtentFull: (v: boolean) => void
} {
  let dual = opts.dual
  const ceilings = { ...opts.initialCeilings }
  /** Single cohort extent for every stat row (leader caps vs full search bounds). */
  let extentFull = false

  function pickRange(axis: StatFilterAxisKey): { lo: number; hi: number } | null {
    const primary = extentFull ? dual.full[axis] : dual.bounded[axis]
    const fallback = extentFull ? dual.bounded[axis] : dual.full[axis]
    return primary ?? fallback ?? null
  }

  /** Distinct rounded stat values within current bar extent (`pickRange`). */
  function discreteAxisValues(axis: StatFilterAxisKey): number[] {
    return sortedUniqueAxisValues(opts.featByTrip, axis, pickRange(axis))
  }

  const wrap = document.createElement("div")
  wrap.className = "results-overall-stats"

  const sliders = document.createElement("div")
  sliders.className = "trip-stat-max-grid"

  type AxisBind = {
    axis: StatFilterAxisKey
    kind: "price" | "min" | "seg"
    label: string
    uniques: number[]
    minOut: HTMLOutputElement
    previewOut: HTMLOutputElement
    range: HTMLInputElement
    out: HTMLOutputElement
    fmtOut: (v: number) => string
  }
  const binds: AxisBind[] = []

  const axisDefs: {
    key: StatFilterAxisKey
    label: string
    describe: string
    kind: "price" | "min" | "seg"
  }[] = [
    { key: "price", label: "Price", describe: "Best fare on the itinerary (EUR).", kind: "price" },
    {
      key: "scheduled",
      label: "Total duration",
      describe: "Σ flight minutes + Σ connection_time (whole itinerary).",
      kind: "min",
    },
    {
      key: "connections",
      label: "Stops",
      describe: "Counted connection segments (outbound + return).",
      kind: "seg",
    },
    {
      key: "wait",
      label: "Total layover",
      describe: "Σ connection-only minutes between legs (airport time between flights).",
      kind: "min",
    },
  ]

  function syncDiscreteRangeDom(b: AxisBind, uniLen: number, idx: number): void {
    b.range.min = "0"
    b.range.max = String(Math.max(0, uniLen - 1))
    b.range.step = "1"
    const clamped = uniLen <= 0 ? 0 : Math.max(0, Math.min(uniLen - 1, Math.round(idx)))
    b.range.value = String(clamped)
  }

  function applyAxisGeometry(b: AxisBind, emitParent: boolean): void {
    const cr = pickRange(b.axis)
    const uniques = discreteAxisValues(b.axis)
    b.uniques = uniques

    function disableRow(): void {
      b.minOut.textContent = "—"
      b.range.disabled = true
      b.range.setAttribute("data-empty", "1")
      b.range.style.setProperty("--trip-stat-fill-pct", "0%")
    }

    function enableRow(): void {
      b.range.disabled = false
      b.range.removeAttribute("data-empty")
    }

    if (!cr || uniques.length === 0) {
      disableRow()
    } else {
      enableRow()

      const snapped = snapCeilingToObservedAscending(uniques, ceilings[b.axis])
      ceilings[b.axis] = snapped
      b.minOut.textContent = b.fmtOut(uniques[0]!)
      b.out.textContent = b.fmtOut(snapped)
      b.range.setAttribute("aria-valuetext", b.fmtOut(snapped))

      const idx = uniques.indexOf(snapped)
      syncDiscreteRangeDom(b, uniques.length, idx >= 0 ? idx : 0)
      setTripStatMaxDiscreteBarPct(b.range, idx >= 0 ? idx : 0, uniques.length)
    }

    if (emitParent) opts.onCeilingsChange({ ...ceilings })
  }

  for (const def of axisDefs) {
    if (pickRange(def.key) == null) continue

    const row = document.createElement("div")
    row.className = "trip-score-row trip-stat-max-axis"

    const headRow = document.createElement("div")
    headRow.className = "trip-stat-max-axis-head"

    const labId = `trip-stat-max-label-${def.key}`
    const labTop = document.createElement("span")
    labTop.className = "trip-score-label-text"
    labTop.id = labId
    labTop.textContent = def.label

    const minOut = document.createElement("output")
    minOut.className = "trip-stat-extent-min"
    minOut.id = `trip-stat-max-min-${def.key}`
    minOut.setAttribute("aria-label", `${def.label}, minimum value on slider cohort`)

    const previewOut = document.createElement("output")
    previewOut.className = "trip-stat-trip-value"
    previewOut.setAttribute("aria-label", `${def.label}, selected trip`)
    previewOut.textContent = "—"

    const out = document.createElement("output")
    out.className = "trip-score-value trip-stat-ceiling-value"
    out.id = `trip-stat-max-val-${def.key}`
    out.setAttribute("aria-label", `${def.label}, maximum filter`)

    const barRow = document.createElement("div")
    barRow.className = "trip-stat-max-bar-row"

    const range = document.createElement("input")
    range.type = "range"
    range.className = "trip-stat-max-range"
    range.id = `trip-stat-max-range-${def.key}`
    range.min = "0"
    range.max = "0"
    range.step = "1"
    range.value = "0"
    range.setAttribute("aria-labelledby", labId)

    const valuesFoot = document.createElement("div")
    valuesFoot.className = "trip-stat-max-values-row"

    const fmtOut = (v: number): string => {
      if (def.kind === "price") return fmtMoney(Math.round(v), "EUR")
      if (def.kind === "min") return fmtDur(v)
      return String(Math.round(v))
    }

    headRow.append(labTop, previewOut)
    barRow.append(range)
    valuesFoot.append(minOut, out)
    row.append(headRow, barRow, valuesFoot)

    const b: AxisBind = {
      axis: def.key,
      kind: def.kind,
      label: def.label,
      uniques: [],
      minOut,
      previewOut,
      range,
      out,
      fmtOut,
    }
    binds.push(b)

    range.addEventListener("input", () => {
      if (pickRange(def.key) == null) return
      const uni = discreteAxisValues(def.key)
      if (uni.length === 0) return
      b.uniques = uni
      const idx = Math.max(0, Math.min(uni.length - 1, Math.round(Number(range.value))))
      range.value = String(idx)
      const cap = uni[idx]!
      ceilings[def.key] = cap
      out.textContent = fmtOut(cap)
      setTripStatMaxDiscreteBarPct(range, idx, uni.length)
      const label = fmtOut(cap)
      range.setAttribute("aria-valuetext", label)
      opts.onCeilingsChange({ ...ceilings })
    })

    applyAxisGeometry(b, false)
    sliders.appendChild(row)
  }

  function refreshDual(next: TripStatDualRanges): void {
    dual = next
    const before = JSON.stringify(ceilings)
    for (const b of binds) {
      applyAxisGeometry(b, false)
    }
    if (JSON.stringify(ceilings) !== before) opts.onCeilingsChange({ ...ceilings })
  }

  function getExtentFull(): boolean {
    return extentFull
  }

  function setExtentFull(v: boolean): void {
    extentFull = v
    const before = JSON.stringify(ceilings)
    for (const b of binds) applyAxisGeometry(b, false)
    if (JSON.stringify(ceilings) !== before) opts.onCeilingsChange({ ...ceilings })
  }

  function setSelectedFeat(feat: TripScoreFeat | null): void {
    for (const b of binds) {
      if (!feat) {
        b.previewOut.textContent = "—"
        continue
      }
      const raw = statMetricForMaxFilter(b.axis, feat)
      b.previewOut.textContent = b.fmtOut(Math.round(Number(raw)))
    }
  }

  wrap.append(sliders)
  return { wrap, refreshDual, setSelectedFeat, getExtentFull, setExtentFull }
}

function sortTripLegsByOrder(legs: readonly UiLeg[]): UiLeg[] {
  return [...legs].sort((a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id)))
}

/** Clock minutes-from-midnight of the first ordered leg's departure in this direction, or null. */
function firstLegDepartureClockMinutes(legs: readonly UiLeg[], flightById: Map<string, UiFlight>): number | null {
  const ordered = sortTripLegsByOrder(legs)
  const leg0 = ordered[0]
  if (!leg0) return null
  const fl = flightById.get(leg0.flight)
  if (!fl) return null
  return parseClockMinutesFromPortal(fl.departure_time)
}

/**
 * Minutes-of-day baselines so each trip bar’s leading gray starts at (this first dep − cohort earliest first dep).
 * Outbound/inbound mins are pooled separately across all rendered trips that have legs in that direction.
 */
function computeMinuteBarLeadBaselines(opts: {
  tripIds: readonly string[]
  allLegs: readonly UiLeg[]
  flightById: Map<string, UiFlight>
  dealsByTrip: Map<string, UiDeal[]>
}): { outbound: number | null; inbound: number | null } {
  let outboundMin = Number.POSITIVE_INFINITY
  let inboundMin = Number.POSITIVE_INFINITY
  let outboundAny = false
  let inboundAny = false

  for (const tid of opts.tripIds) {
    const deals = opts.dealsByTrip.get(tid)
    if (!deals?.length) continue
    const { outbound, inbound } = inferTripDirections(tid, opts.allLegs, opts.flightById, deals)
    const ob = firstLegDepartureClockMinutes(outbound, opts.flightById)
    if (ob != null) {
      outboundAny = true
      outboundMin = Math.min(outboundMin, ob)
    }
    const ib = firstLegDepartureClockMinutes(inbound, opts.flightById)
    if (ib != null) {
      inboundAny = true
      inboundMin = Math.min(inboundMin, ib)
    }
  }

  return {
    outbound: outboundAny ? outboundMin : null,
    inbound: inboundAny ? inboundMin : null,
  }
}

function tripDealsSuggestReturn(deals: readonly UiDeal[] | undefined): boolean {
  const list = deals ?? []
  return list.some((d) => {
    const r = d.return_date
    return r != null && String(r).length > 0
  })
}

function buildTripDirectionIndicators(legs: UiLeg[], flightById: Map<string, UiFlight>): HTMLElement {
  const stats = document.createElement("div")
  stats.className = "trip-direction-stats"
  stats.setAttribute("role", "group")
  stats.setAttribute("aria-label", "Duration and layover")

  if (legs.length === 0) {
    const p = document.createElement("p")
    p.className = "trip-missing"
    p.textContent = "No segments for this direction."
    stats.appendChild(p)
    return stats
  }

  const mkStat = (statLabel: string, value: string, title?: string): HTMLElement => {
    const cell = document.createElement("span")
    cell.className = "trip-dir-stat"
    const lb = document.createElement("span")
    lb.className = "trip-dir-stat-label"
    lb.textContent = statLabel
    const val = document.createElement("span")
    val.className = "trip-dir-stat-value"
    val.textContent = value
    if (title) {
      cell.title = title
      lb.title = title
      val.title = title
    }
    cell.append(lb, val)
    return cell
  }

  const block = directionalBlockTotals(legs, flightById)
  const tripTimeMin = Math.max(block.flyMin + block.connMin, 1)
  const tripTitle =
    "Sum of airborne minutes (each flight’s duration) plus layover minutes (each leg’s connection_time before the next segment) in this direction."
  const waitStr =
    block.stopsHint === 0
      ? "—"
      : block.connMin > 0
        ? fmtDur(block.connMin)
        : "—"
  const waitTitle =
    block.stopsHint === 0
      ? "Nonstop — no layovers between flights."
      : block.connMin > 0
        ? "Total layover time between flights (sum of connection_time on legs before each onward segment)."
        : "Connection times not present in data for this direction."

  const sep = document.createElement("span")
  sep.className = "trip-dir-sep"
  sep.setAttribute("aria-hidden", "true")
  sep.textContent = "·"

  stats.append(mkStat("duration", fmtDur(Math.round(tripTimeMin)), tripTitle), sep, mkStat("layover", waitStr, waitTitle))
  return stats
}

function buildTripDirectionTimeline(
  legs: UiLeg[],
  flightById: Map<string, UiFlight>,
  minuteBarLeadBaselineClockMin: number | null,
): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "trip-dir-bar"
  if (legs.length === 0) return wrap

  const timeline = buildTripTimeline(legs, flightById, minuteBarLeadBaselineClockMin)
  if (timeline) {
    wrap.appendChild(timeline.root)
  } else {
    const ol = document.createElement("ol")
    ol.className = "leg-list"
    for (const leg of legs) {
      ol.appendChild(renderLegItem(leg, flightById.get(leg.flight)))
    }
    wrap.appendChild(ol)
  }
  return wrap
}

function buildBookDealsDropdown(deals: readonly UiDeal[]): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "book-deals"

  const sortedDeals = [...deals].sort((a, b) => a.price - b.price || String(a.id).localeCompare(String(b.id)))

  const btn = document.createElement("button")
  btn.type = "button"
  btn.className = "book-deals-toggle"
  btn.textContent = sortedDeals.length <= 1 ? "Book" : `Book (${sortedDeals.length} offers)`
  btn.setAttribute("aria-expanded", "false")
  btn.setAttribute("aria-haspopup", "true")

  const panel = document.createElement("div")
  panel.className = "book-deals-panel"
  panel.hidden = true
  panel.setAttribute("role", "menu")

  if (sortedDeals.length === 0) {
    btn.disabled = true
    btn.textContent = "No booking links"
  } else {
    for (const deal of sortedDeals) {
      const row = document.createElement("a")
      row.className = "book-deals-option"
      row.href = deal.link
      row.target = "_blank"
      row.rel = "noopener noreferrer"
      row.setAttribute("role", "menuitem")
      row.innerHTML = `<span class="book-deals-opt-prov">${escapeHtml(deal.provider)}</span> <span class="book-deals-opt-price">${escapeHtml(fmtMoney(deal.price, "EUR"))}</span>`
      panel.appendChild(row)
    }
  }

  btn.addEventListener("click", () => {
    if (btn.disabled || sortedDeals.length === 0) return
    const open = panel.hidden
    panel.hidden = !open
    btn.setAttribute("aria-expanded", open ? "true" : "false")
  })

  wrap.append(btn, panel)
  return wrap
}

function renderTripDetailFlat(
  tripId: string,
  allLegs: readonly UiLeg[],
  flightById: Map<string, UiFlight>,
  deals: readonly UiDeal[] | undefined,
  extras: {
    minuteBarOutboundLeadBaseline: number | null
    minuteBarInboundLeadBaseline: number | null
  },
): HTMLElement {
  const dealList = Array.isArray(deals) ? deals : []

  const root = document.createElement("div")
  root.className = "trip-detail"

  const { outbound, inbound } = inferTripDirections(tripId, allLegs, flightById, dealList)
  const showReturnRow = inbound.length > 0 || tripDealsSuggestReturn(dealList)

  function appendDirection(title: string, legs: UiLeg[], baseline: number | null): void {
    const ht = document.createElement("h3")
    ht.className = "results-section-title"
    ht.textContent = title
    root.appendChild(ht)

    root.appendChild(buildTripDirectionIndicators(legs, flightById))

    root.appendChild(buildTripDirectionTimeline(legs, flightById, baseline))
  }

  if (outbound.length === 0 && inbound.length === 0) {
    const miss = document.createElement("p")
    miss.className = "trip-missing"
    miss.textContent = "No leg breakdown in data for this trip."
    root.appendChild(miss)
  } else {
    appendDirection("Outbound", outbound, extras.minuteBarOutboundLeadBaseline)
    if (showReturnRow) appendDirection("Return", inbound, extras.minuteBarInboundLeadBaseline)
  }

  root.appendChild(buildBookDealsDropdown(dealList))
  return root
}

function renderDirection(
  label: string,
  legs: UiLeg[],
  flightById: Map<string, UiFlight>,
  minuteBarLeadBaselineClockMin: number | null,
): HTMLElement {
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

  wrap.append(
    h,
    buildTripDirectionIndicators(legs, flightById),
    buildTripDirectionTimeline(legs, flightById, minuteBarLeadBaselineClockMin),
  )
  return wrap
}

type TripTimelineSeg = {
  leg: UiLeg
  flight: UiFlight
  depMs: number
  arrMs: number
}

/** One-day (1440-min) proportional bar: dep clock + Σ flies + Σ connections + trailing-to-midnight. */
type TripBarMinuteBudget = {
  totalMin: number
  segLeftPct: readonly number[]
  segWidthPct: readonly number[]
  depMarkerPct: readonly number[]
  arrMarkerPct: readonly number[]
}

const MINUTES_PER_DAY = 1440

/**
 * Sum lead gray + durations + layovers + tail gray (1440 − last arrival clock minutes). Each share is slice/total.
 * Lead gray = first segment departure clock minutes − `leadBaselineClockMin` when baseline is finite (otherwise full
 * minutes-from-midnight, legacy behavior).
 */
function tryBuildTripMinuteBarBudget(
  segs: readonly TripTimelineSeg[],
  leadBaselineClockMin: number | null,
): TripBarMinuteBudget | null {
  if (segs.length === 0) return null
  const first = segs[0]!.flight
  const lastF = segs[segs.length - 1]!.flight
  const firstDepClockMin = parseClockMinutesFromPortal(first.departure_time)
  const lastArrMin = parseClockMinutesFromPortal(lastF.arrival_time)
  if (firstDepClockMin == null || lastArrMin == null) return null

  const leadMin =
    leadBaselineClockMin != null && Number.isFinite(leadBaselineClockMin)
      ? Math.max(0, firstDepClockMin - leadBaselineClockMin)
      : firstDepClockMin

  const tailMin = Math.max(0, MINUTES_PER_DAY - lastArrMin)
  let total = leadMin + tailMin
  const durs: number[] = []
  const conns: number[] = []

  for (let i = 0; i < segs.length; i++) {
    const dur = segs[i]!.flight.duration
    if (dur == null || !Number.isFinite(dur) || dur <= 0) return null
    durs.push(dur)
    total += dur
    if (i < segs.length - 1) {
      const c = segs[i]!.leg.connection_time
      if (c == null || !Number.isFinite(c) || c < 0) return null
      conns.push(c)
      total += c
    }
  }

  if (!(total > 0)) return null

  const segLeftPct: number[] = []
  const segWidthPct: number[] = []
  const depMarkerPct: number[] = []
  const arrMarkerPct: number[] = []

  let cursor = leadMin
  for (let i = 0; i < segs.length; i++) {
    depMarkerPct.push((cursor / total) * 100)
    segLeftPct.push(depMarkerPct[i]!)
    segWidthPct.push((durs[i]! / total) * 100)
    cursor += durs[i]!
    arrMarkerPct.push((cursor / total) * 100)
    if (i < segs.length - 1) cursor += conns[i]!
  }

  return { totalMin: total, segLeftPct, segWidthPct, depMarkerPct, arrMarkerPct }
}

const MS_PER_DAY = 86_400_000

function utcMidnightIsoDateMs(isoDate: string): number | null {
  const t = Date.parse(`${isoDate}T00:00:00Z`)
  return Number.isFinite(t) ? t : null
}

function utcCalendarMidnightContainingMs(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
}

/** Exclusive end of the UTC calendar day that contains `ms` (next 00:00 UTC at or after that day’s end). */
function utcExclusiveEndMidnightAfterMs(ms: number): number {
  let end = utcCalendarMidnightContainingMs(ms) + MS_PER_DAY
  while (ms >= end) end += MS_PER_DAY
  return end
}

/**
 * Bar axis `[axisStart, axisEnd)` where:
 * left padding = scraped first departure − `axisStart` (midnight-aligned “00:00 → departure” window),
 * right padding = `axisEnd` − last **scraped arrival** (“arrival → 24:00” on that UTC day).
 * Extend `axisEnd` past that midnight if chained `arrMs` runs past scraped arrival (handles duration vs clock skew).
 */
function tripBarAxisUtcBounds(segs: TripTimelineSeg[]): { axisStart: number; axisEnd: number } | null {
  if (segs.length === 0) return null
  const tripStartMs = segs[0]!.depMs
  const chainEndMs = segs[segs.length - 1]!.arrMs
  if (!(chainEndMs > tripStartMs)) return null

  let axisStart = utcCalendarMidnightContainingMs(tripStartMs)
  const depSeed = utcMidnightIsoDateMs(flightDepDateIso(segs[0]!.flight))
  if (depSeed != null) axisStart = Math.min(axisStart, depSeed)
  while (tripStartMs < axisStart) axisStart -= MS_PER_DAY

  let lastInstantMs = chainEndMs
  const wallArrLast = flightArriveMs(segs[segs.length - 1]!.flight)
  if (wallArrLast != null && Number.isFinite(wallArrLast) && wallArrLast > tripStartMs) {
    lastInstantMs = Math.max(lastInstantMs, wallArrLast)
  }

  let axisEnd = utcExclusiveEndMidnightAfterMs(lastInstantMs)

  /** If duration chain spills past midnight from `wallArrLast` but still lands on earlier calendar day semantics, bump. */
  while (axisEnd < chainEndMs) axisEnd += MS_PER_DAY

  if (!(axisEnd > axisStart)) return null
  return { axisStart, axisEnd }
}

/** Whole calendar days between local arrival date and next local departure date (non-negative). */
function calendarDayDelta(arrIso: string, depIso: string): number {
  const a = new Date(arrIso + "T12:00:00Z").getTime()
  const b = new Date(depIso + "T12:00:00Z").getTime()
  const raw = (b - a) / MS_PER_DAY
  return Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0
}

/**
 * Piece the timeline as: gray `[axisStart … first departure]`, then for each leg in order —
 * **`flight.duration` (color)** and **`connection_time` (gray)** except no gray after the last leg.
 * Matches “00:00 → dep · fly · conn · fly · … · fly · arr → 24:00” on the scraped UTC-ish clocks.
 */
function assignTimelineFromFlightDurationsAndLayovers(segs: TripTimelineSeg[]): boolean {
  const anchor = flightDepartMs(segs[0]!.flight)
  if (anchor == null || !Number.isFinite(anchor)) return false
  let cursor = anchor
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!
    const dur = s.flight.duration
    if (dur == null || !Number.isFinite(dur) || dur <= 0) return false
    s.depMs = cursor
    s.arrMs = cursor + dur * 60_000
    cursor = s.arrMs
    if (i >= segs.length - 1) break
    const lay = s.leg.connection_time
    if (lay == null || !Number.isFinite(lay) || lay < 0) return false
    cursor += lay * 60_000
  }
  return true
}

function pctOnSpan(ms: number, t0: number, span: number): number {
  if (!(span > 0)) return 0
  const raw = ((ms - t0) / span) * 100
  return Math.max(0, Math.min(100, raw))
}

/**
 * Layover gap markers from local calendar dates (not synthetic ms midnights): spread dividers
 * evenly when the next departure date is later than the previous arrival date.
 */
function layoverCalendarDividerPcts(segs: TripTimelineSeg[], t0: number, span: number): number[] {
  const out: number[] = []
  for (let i = 0; i < segs.length - 1; i++) {
    const gapStart = segs[i]!.arrMs
    const gapEnd = segs[i + 1]!.depMs
    if (!(gapEnd > gapStart)) continue

    const dayDelta = calendarDayDelta(flightArrDateIso(segs[i]!.flight), flightDepDateIso(segs[i + 1]!.flight))
    if (dayDelta <= 0) continue

    const gapLen = gapEnd - gapStart
    for (let k = 1; k <= dayDelta; k++) {
      const t = gapStart + (gapLen * k) / (dayDelta + 1)
      out.push(pctOnSpan(t, t0, span))
    }
  }
  return out
}

/** Same semantics as {@link layoverCalendarDividerPcts}, but percents lie between connection gaps on the minute-budget bar. */
function minuteBudgetLayoverCalendarDividerPcts(segs: readonly TripTimelineSeg[], budget: TripBarMinuteBudget): number[] {
  const out: number[] = []
  for (let i = 0; i < segs.length - 1; i++) {
    const gapStartPct = budget.arrMarkerPct[i]!
    const gapEndPct = budget.depMarkerPct[i + 1]!
    if (!(gapEndPct > gapStartPct)) continue

    const dayDelta = calendarDayDelta(flightArrDateIso(segs[i]!.flight), flightDepDateIso(segs[i + 1]!.flight))
    if (dayDelta <= 0) continue

    const gapLenPct = gapEndPct - gapStartPct
    for (let k = 1; k <= dayDelta; k++) {
      const tPct = gapStartPct + (gapLenPct * k) / (dayDelta + 1)
      out.push(tPct)
    }
  }
  return out
}

function flightDepDateIso(f: UiFlight): string {
  return f.departure_date
}

function flightArrDateIso(f: UiFlight): string {
  if (f.arrival_date) return f.arrival_date
  return inferArrivalDateIsoFromPortalClocks({
    departure_date: f.departure_date,
    departure_time: f.departure_time,
    arrival_time: f.arrival_time,
  })
}

/** True when the segment likely crosses a calendar day (overnight, long-haul, or TZ implied by schedule). */
function flightLikelyCrossesCalendarDay(f: UiFlight, durationMin: number): boolean {
  if (flightDepDateIso(f) !== flightArrDateIso(f)) return true
  if (durationMin > MINUTES_PER_DAY) return true
  const depM = parseClockMinutesFromPortal(f.departure_time)
  if (depM != null && depM + durationMin > MINUTES_PER_DAY) return true
  return false
}

/** UTC instants 00:00 strictly after `startMs` and strictly before `endMs`. */
function utcMidnightsBetweenExclusive(startMs: number, endMs: number): number[] {
  const out: number[] = []
  if (!(endMs > startMs)) return out
  let cur = utcCalendarMidnightContainingMs(startMs) + MS_PER_DAY
  while (cur <= startMs) cur += MS_PER_DAY
  while (cur < endMs) {
    out.push(cur)
    cur += MS_PER_DAY
  }
  return out
}

function flightWallDepArrMs(f: UiFlight): { depMs: number; arrMs: number } | null {
  const depMs = flightDepartMs(f)
  if (depMs == null) return null
  const arrMs = flightArriveMs(f)
  if (arrMs == null || !(arrMs > depMs)) return null
  return { depMs, arrMs }
}

/**
 * During-flight day boundaries on the bar: UTC midnights between wall dep/arr, placed using block time `duration`
 * plus schedule skew `(arr−dep)−duration` spread linearly along the colored segment (minute-budget), or wall-linear
 * on the UTC axis bar.
 */
function inFlightCalendarDividerPcts(
  segs: readonly TripTimelineSeg[],
  minuteBudget: TripBarMinuteBudget | null,
  axisStart: number,
  axisSpan: number,
): number[] {
  const out: number[] = []
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!
    const f = s.flight
    const durMin = f.duration
    if (durMin == null || !Number.isFinite(durMin) || durMin <= 0) continue
    if (!flightLikelyCrossesCalendarDay(f, durMin)) continue

    const wall = flightWallDepArrMs(f)
    if (!wall) continue

    const durMs = durMin * 60_000
    const skewMs = wall.arrMs - wall.depMs - durMs
    const denom = durMs + skewMs
    if (!(Math.abs(denom) > 60_000)) continue

    const midnights = utcMidnightsBetweenExclusive(wall.depMs, wall.arrMs)

    if (minuteBudget != null) {
      const leftSeg = minuteBudget.depMarkerPct[i]!
      const wSeg = minuteBudget.arrMarkerPct[i]! - leftSeg
      if (!(wSeg > 0)) continue
      for (const m of midnights) {
        const p = (m - wall.depMs) / denom
        if (p > 0.002 && p < 0.998) out.push(leftSeg + p * wSeg)
      }
    } else {
      const leftSeg = pctOnSpan(s.depMs, axisStart, axisSpan)
      const segEndMs = flightArrInstantMsOrChainEnd(s)
      const rightSeg = pctOnSpan(segEndMs, axisStart, axisSpan)
      if (!(rightSeg > leftSeg)) continue
      const wallSpan = wall.arrMs - wall.depMs
      if (!(wallSpan > 60_000)) continue
      for (const m of midnights) {
        if (m <= wall.depMs || m >= wall.arrMs) continue
        const pWall = (m - wall.depMs) / wallSpan
        if (pWall <= 0.002 || pWall >= 0.998) continue
        out.push(leftSeg + pWall * (rightSeg - leftSeg))
      }
    }
  }
  return out
}

/** Drop divider positions within `epsPct` (merge accidental duplicates between layover + in-flight logic). */
function dedupeNearbySortedPcts(pcts: readonly number[], epsPct = 0.2): number[] {
  if (pcts.length === 0) return []
  const sorted = [...pcts].sort((a, b) => a - b)
  const out: number[] = [sorted[0]!]
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i]!
    if (Math.abs(p - out[out.length - 1]!) > epsPct) out.push(p)
  }
  return out
}

type IataOverlapBoundary = {
  prevEnd: HTMLElement
  nextStart: HTMLElement
  midPct: number
  destCode: string
  origCode: string
}

/**
 * Grow each label box by this many CSS pixels on every side before testing overlap.
 * Treats abutting / near-touching labels (e.g. MEX|MEX) as overlapping so they merge.
 */
const IATA_LABEL_MERGE_INFLATE_PX = 10

function rectsOverlap2DInflated(a: DOMRectReadOnly, b: DOMRectReadOnly, inflatePx: number): boolean {
  const ax1 = a.left - inflatePx
  const ax2 = a.right + inflatePx
  const ay1 = a.top - inflatePx
  const ay2 = a.bottom + inflatePx
  const bx1 = b.left - inflatePx
  const bx2 = b.right + inflatePx
  const by1 = b.top - inflatePx
  const by2 = b.bottom + inflatePx
  return Math.max(ax1, bx1) < Math.min(ax2, bx2) && Math.max(ay1, by1) < Math.min(ay2, by2)
}

function applyIataOverlapMerges(track: HTMLElement, boundaries: readonly IataOverlapBoundary[]): void {
  for (const b of boundaries) {
    if (!b.prevEnd.isConnected || !b.nextStart.isConnected) continue
    const ra = b.prevEnd.getBoundingClientRect()
    const rb = b.nextStart.getBoundingClientRect()
    if (ra.width <= 0 || rb.width <= 0) continue
    if (!rectsOverlap2DInflated(ra, rb, IATA_LABEL_MERGE_INFLATE_PX)) continue

    const text = b.destCode === b.origCode ? b.destCode : `${b.destCode}-${b.origCode}`
    const el = document.createElement("span")
    el.className = "trip-bar-seg-iata trip-bar-seg-iata-junction"
    el.style.left = `${b.midPct}%`
    el.setAttribute("aria-hidden", "true")
    el.textContent = text
    track.appendChild(el)
    b.prevEnd.remove()
    b.nextStart.remove()
  }
}

const tripTrackIataBoundaries = new WeakMap<HTMLElement, readonly IataOverlapBoundary[]>()

function flushTripBarIataMergeForTrack(track: HTMLElement): void {
  const boundaries = tripTrackIataBoundaries.get(track)
  if (!boundaries?.length || !track.isConnected) return
  applyIataOverlapMerges(track, boundaries)
}

function hideTripBarIataForCarouselSwap(panel: HTMLElement): void {
  for (const node of panel.querySelectorAll(".trip-detail .trip-bar-seg-iata")) {
    ;(node as HTMLElement).classList.add("trip-bar-seg-iata--xfade-hide")
  }
}

function fadeInTripBarIata(panel: HTMLElement): void {
  if (!panel.isConnected) return
  void panel.offsetHeight
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      for (const node of panel.querySelectorAll(".trip-detail .trip-bar-seg-iata")) {
        const el = node as HTMLElement
        el.classList.remove("trip-bar-seg-iata--xfade-hide", "trip-bar-seg-iata--xfade-leave")
        el.classList.add("trip-bar-seg-iata--xfade-enter")
      }
    })
  })
}

/** After segment morph: marker stagger, hub merge flush, cross-fade IATA in (no sliding label morph). */
function finalizeTripBarMorph(panel: HTMLElement): void {
  tripBarMorphEffectsSuppressedUntil = 0
  for (const stack of panel.querySelectorAll(".trip-bar-stack")) {
    const el = stack as HTMLElement
    if (!el.isConnected) continue
    const above = el.querySelector(":scope > .trip-bar-markers-above")
    const below = el.querySelector(":scope > .trip-bar-markers-below")
    if (above instanceof HTMLElement) applyDatetimeMarkerStagger(above)
    if (below instanceof HTMLElement) applyDatetimeMarkerStagger(below)
  }
  for (const tr of panel.querySelectorAll(".trip-detail .trip-bar-track")) {
    flushTripBarIataMergeForTrack(tr as HTMLElement)
  }
  hideTripBarIataForCarouselSwap(panel)
  fadeInTripBarIata(panel)
}

/** Run after layout; repeat on resize so labels are measured with real geometry. */
function scheduleTripIataOverlapMerge(track: HTMLElement, boundaries: readonly IataOverlapBoundary[]): void {
  tripTrackIataBoundaries.set(track, boundaries)
  if (boundaries.length === 0) return
  let rafQueued = false
  const flush = (): void => {
    rafQueued = false
    if (!track.isConnected) return
    if (performance.now() < tripBarMorphEffectsSuppressedUntil) {
      const wait = Math.max(12, tripBarMorphEffectsSuppressedUntil - performance.now())
      window.setTimeout(queue, wait)
      return
    }
    const latest = tripTrackIataBoundaries.get(track) ?? boundaries
    applyIataOverlapMerges(track, latest)
  }
  const queue = (): void => {
    if (rafQueued) return
    rafQueued = true
    requestAnimationFrame(flush)
  }
  queue()
  const ro = new ResizeObserver(queue)
  ro.observe(track)
}

const DATETIME_MARKER_OVERLAP_PAD_PX = 4
/** Extra gap when nudging overlapping clocks (beyond one measured label box height). */
const DATETIME_MARKER_STAGGER_GAP_PX = 3

function markerMeasuredBlockHeightPx(marker: HTMLElement, fallbackLhPx: number): number {
  const h = marker.getBoundingClientRect().height
  if (Number.isFinite(h) && h > 4) return h
  return Math.max(fallbackLhPx * 1.08, fallbackLhPx + 4)
}

/**
 * Stagger overlapping departure/arrival clocks: if two neighbours collide, nudge the **earlier** one upward by exactly
 * one label height plus a tiny padding — no multi-pass stacking.
 */
function applyDatetimeMarkerStagger(container: HTMLElement): void {
  const markers = [...container.querySelectorAll(":scope > .trip-bar-marker")] as HTMLElement[]
  if (markers.length <= 1) return

  markers.sort((a, b) => (parseFloat(a.style.left || "0") || 0) - (parseFloat(b.style.left || "0") || 0))

  for (const m of markers) {
    m.style.transform = ""
  }

  container.getBoundingClientRect()

  const lh0 = markerTimeLineHeightPx(markers[0]!)
  const oneStepPx =
    markerMeasuredBlockHeightPx(markers[0]!, lh0) + DATETIME_MARKER_STAGGER_GAP_PX

  const bumped = new Array(markers.length).fill(false)

  for (let k = 1; k < markers.length; k++) {
    const prev = markers[k - 1]!
    const cur = markers[k]!
    if (!prev.isConnected || !cur.isConnected) continue
    const rp = prev.getBoundingClientRect()
    const rc = cur.getBoundingClientRect()
    if (!(rp.width > 0) || !(rc.width > 0)) continue
    if (!rectsOverlap2DInflated(rp, rc, DATETIME_MARKER_OVERLAP_PAD_PX)) continue
    bumped[k - 1] = true
  }

  for (let i = 0; i < markers.length; i++) {
    markers[i].style.transform =
      bumped[i] === true ? `translateX(-50%) translateY(${-oneStepPx}px)` : ""
  }
}

function markerTimeLineHeightPx(sampleMarker: HTMLElement): number {
  const el = sampleMarker.querySelector(".trip-bar-marker-time") as HTMLElement | null
  const cs = el != null ? getComputedStyle(el) : getComputedStyle(sampleMarker)
  const lhRaw = cs.lineHeight
  const lh = parseFloat(lhRaw)
  if (Number.isFinite(lh) && lh > 0 && lhRaw !== "normal") return lh
  const fs = parseFloat(cs.fontSize)
  return Number.isFinite(fs) && fs > 0 ? Math.max(14, fs * 1.2) : 18
}

/** Debounced reflow passes when trip bar geometry changes so overlap checks use real rects. */
function scheduleDatetimeMarkerStagger(stack: HTMLElement): void {
  const above = stack.querySelector(":scope > .trip-bar-markers-above") as HTMLElement | null
  const below = stack.querySelector(":scope > .trip-bar-markers-below") as HTMLElement | null
  if (!above && !below) return

  const flush = (): void => {
    if (performance.now() < tripBarMorphEffectsSuppressedUntil) {
      const wait = Math.max(12, tripBarMorphEffectsSuppressedUntil - performance.now())
      window.setTimeout(queue, wait)
      return
    }
    if (above?.isConnected) applyDatetimeMarkerStagger(above)
    if (below?.isConnected) applyDatetimeMarkerStagger(below)
  }

  let rafQueued = false
  const queue = (): void => {
    if (rafQueued) return
    rafQueued = true
    window.requestAnimationFrame(() => {
      rafQueued = false
      flush()
    })
  }
  queue()
  const ro = new ResizeObserver(queue)
  ro.observe(stack)
}

/** Marker body on the bar: local clock times only (no calendar dates). */
function tripMarkerDatetimeHtml(_isoDate: string, timeStr: string, _prevIso: string | null): string {
  const timeHtml = `<span class="trip-bar-marker-time">${escapeHtml(fmtClock(timeStr))}</span>`
  return `<span class="trip-bar-marker-datetime trip-bar-marker-datetime-compact">${timeHtml}</span>`
}

function flightArrInstantMsOrChainEnd(s: TripTimelineSeg): number {
  if (s.arrMs <= s.depMs) return s.arrMs
  const w = flightArriveMs(s.flight)
  return w != null && Number.isFinite(w) && w > s.depMs ? w : s.arrMs
}

function buildTripTimeline(
  legs: UiLeg[],
  flightById: Map<string, UiFlight>,
  minuteBarLeadBaselineClockMin: number | null,
): { root: HTMLElement } | null {
  if (legs.length === 0) return null
  const segs: TripTimelineSeg[] = []
  for (const leg of sortTripLegsByOrder(legs)) {
    const flight = flightById.get(leg.flight)
    if (!flight) return null
    segs.push({ leg, flight, depMs: 0, arrMs: 0 })
  }

  const minuteBudget = tryBuildTripMinuteBarBudget(segs, minuteBarLeadBaselineClockMin)

  if (!minuteBudget) {
    if (!assignTimelineFromFlightDurationsAndLayovers(segs)) {
      for (let i = 0; i < segs.length; i++) {
        const ends = flightSegmentEndpointsMs(segs[i]!.flight)
        if (!ends) return null
        segs[i]!.depMs = ends.depMs
        segs[i]!.arrMs = ends.arrMs
      }
    }
  }

  const axis =
    minuteBudget == null ? tripBarAxisUtcBounds(segs) : ({ axisStart: 0, axisEnd: minuteBudget.totalMin } as const)
  if (!axis) return null
  const axisStart = axis.axisStart
  const axisSpan = axis.axisEnd - axisStart
  if (!(axisSpan > 0)) return null

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

  const depPctForLeg = (i: number): number =>
    minuteBudget != null ? minuteBudget.depMarkerPct[i]! : pctOnSpan(segs[i]!.depMs, axisStart, axisSpan)

  const TRIP_BAR_STAGGER_MS = 48

  segs.forEach((s, i) => {
    const mk = document.createElement("div")
    mk.className = "trip-bar-marker trip-bar-marker-at-edge trip-bar-marker--enter"
    mk.style.left = `${depPctForLeg(i)}%`
    mk.style.setProperty("--trip-enter-delay", `${i * TRIP_BAR_STAGGER_MS}ms`)
    const prevIso = i === 0 ? null : flightArrDateIso(segs[i - 1]!.flight)
    const dt = tripMarkerDatetimeHtml(flightDepDateIso(s.flight), s.flight.departure_time, prevIso)
    mk.innerHTML = dt
    above.appendChild(mk)
  })

  const trackWrap = document.createElement("div")
  trackWrap.className = "trip-bar-track-wrap"

  const track = document.createElement("div")
  track.className = "trip-bar-track"

  const layoverDividerPcts =
    minuteBudget != null
      ? minuteBudgetLayoverCalendarDividerPcts(segs, minuteBudget)
      : layoverCalendarDividerPcts(segs, axisStart, axisSpan)
  const inFlightDividerPcts = inFlightCalendarDividerPcts(segs, minuteBudget, axisStart, axisSpan)
  const dividerPcts = dedupeNearbySortedPcts([...layoverDividerPcts, ...inFlightDividerPcts])

  for (let di = 0; di < dividerPcts.length; di++) {
    const pct = dividerPcts[di]!
    const div = document.createElement("div")
    div.className = "trip-bar-layover-day-divider trip-bar-layover-day-divider--enter"
    div.style.left = `${pct}%`
    div.style.setProperty("--trip-enter-delay", `${di * TRIP_BAR_STAGGER_MS + 18}ms`)
    div.setAttribute("aria-hidden", "true")
    div.title = "Calendar day boundary (connection gap, or midnight during a long / overnight segment)"
    track.appendChild(div)
  }

  const labelsBySeg: Array<{ start: HTMLSpanElement; end: HTMLSpanElement }> = []

  const arrPctForLeg = (i: number): number =>
    minuteBudget != null
      ? minuteBudget.arrMarkerPct[i]!
      : pctOnSpan(flightArrInstantMsOrChainEnd(segs[i]!), axisStart, axisSpan)

  segs.forEach((s, index) => {
    const leftPct = minuteBudget != null ? minuteBudget.segLeftPct[index]! : pctOnSpan(s.depMs, axisStart, axisSpan)
    const widthPct =
      minuteBudget != null
        ? Math.max(minuteBudget.segWidthPct[index]!, 0.35)
        : Math.max(pctOnSpan(s.arrMs, axisStart, axisSpan) - leftPct, 0.35)
    const seg = document.createElement("div")
    seg.className = "trip-bar-seg trip-bar-seg--enter"
    seg.style.setProperty("--trip-enter-delay", `${index * TRIP_BAR_STAGGER_MS}ms`)
    seg.dataset.barLeftPct = String(leftPct)
    seg.dataset.barWidthPct = String(widthPct)
    seg.style.left = `${leftPct}%`
    seg.style.width = `${widthPct}%`
    seg.style.background = segmentHueCss(index)
    const depDateStr = fmtEndpointDate(s.flight.departure_date)
    const arrDateStr = fmtEndpointDate(s.flight.arrival_date ?? s.flight.departure_date)
    seg.title = `${s.flight.airline} ${s.flight.flight_number}: ${depDateStr} ${fmtClock(s.flight.departure_time)} → ${arrDateStr} ${fmtClock(s.flight.arrival_time)} (${fmtDur(s.flight.duration)})`

    const startEl = document.createElement("span")
    startEl.className = "trip-bar-seg-iata trip-bar-seg-iata-edge-start"
    startEl.setAttribute("aria-hidden", "true")
    startEl.textContent = airportCode3(s.flight.origin)
    const endEl = document.createElement("span")
    endEl.className = "trip-bar-seg-iata trip-bar-seg-iata-edge-end"
    endEl.setAttribute("aria-hidden", "true")
    endEl.textContent = airportCode3(s.flight.destination)
    seg.append(startEl, endEl)
    labelsBySeg.push({ start: startEl, end: endEl })

    track.appendChild(seg)
  })

  const iataOverlapBoundaries: IataOverlapBoundary[] = []
  for (let i = 0; i < segs.length - 1; i++) {
    const arrPct = minuteBudget != null ? minuteBudget.arrMarkerPct[i]! : pctOnSpan(segs[i]!.arrMs, axisStart, axisSpan)
    const depPct = minuteBudget != null ? minuteBudget.depMarkerPct[i + 1]! : pctOnSpan(segs[i + 1]!.depMs, axisStart, axisSpan)
    iataOverlapBoundaries.push({
      prevEnd: labelsBySeg[i]!.end,
      nextStart: labelsBySeg[i + 1]!.start,
      midPct: (arrPct + depPct) / 2,
      destCode: airportCode3(segs[i]!.flight.destination),
      origCode: airportCode3(segs[i + 1]!.flight.origin),
    })
  }
  scheduleTripIataOverlapMerge(track, iataOverlapBoundaries)

  trackWrap.appendChild(track)

  const below = document.createElement("div")
  below.className = "trip-bar-markers trip-bar-markers-below"
  below.setAttribute("aria-hidden", "true")

  segs.forEach((s, i) => {
    const arrPct = arrPctForLeg(i)
    const mk = document.createElement("div")
    mk.className = "trip-bar-marker trip-bar-marker-at-edge trip-bar-marker--enter"
    mk.style.left = `${arrPct}%`
    mk.style.setProperty("--trip-enter-delay", `${i * TRIP_BAR_STAGGER_MS + Math.round(TRIP_BAR_STAGGER_MS * 0.35)}ms`)
    const prevIso = flightDepDateIso(s.flight)
    const dt = tripMarkerDatetimeHtml(flightArrDateIso(s.flight), s.flight.arrival_time, prevIso)
    mk.innerHTML = dt
    below.appendChild(mk)
  })

  stack.append(above, trackWrap, below)
  scheduleDatetimeMarkerStagger(stack)
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
  d.textContent = `Layover ${fmtDur(Math.round(minutes))}`
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
