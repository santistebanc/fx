const $ = (sel, root = document) => root.querySelector(sel)

const form = $("#search-form")
const btn = $("#submit-btn")
const root = $("#results-root")
const overviewEl = $("#results-overview")
const ph = $("#results-placeholder")
const errEl = $("#results-error")
const statusEl = $("#results-status")
const resultsPanel = $("#results-panel")

const LOADING_HINT = "Searching… Live requests can take up to a minute — hang tight."
const IDLE_PLACEHOLDER = "Run a search to see trips and prices. All selected feeds are merged into one list ranked by best fare per trip."

const fmtMoney = (cents, currency = "EUR") => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100)
  } catch {
    return `€${(cents / 100).toFixed(0)}`
  }
}

const fmtDateShort = (iso) => {
  if (!iso) return "—"
  const d = new Date(iso + "T12:00:00Z")
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(d)
}

const fmtDur = (minutes) => {
  if (minutes == null || Number.isNaN(minutes)) return "—"
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h <= 0) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}

function wireRoundTrip() {
  const rt = form.elements.roundTrip
  const ret = form.elements.returnDate
  const onChange = () => {
    ret.disabled = !rt.checked
    ret.required = rt.checked
  }
  rt.addEventListener("change", onChange)
  onChange()
}

function upperIata(el) {
  el.addEventListener("blur", () => {
    el.value = el.value.trim().toUpperCase().slice(0, 3)
  })
}

upperIata(form.elements.origin)
upperIata(form.elements.destination)

wireRoundTrip()

const PAGE_SIZE_OPTIONS = [10, 15, 25, 50, 100]

/** Paginates full result sets from the API (client-side only; backend sends all deals). */
function appendPaginatedList(parent, options) {
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

  const pickSize = pageSizes.includes(initialPageSize) ? initialPageSize : pageSizes[0]
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
  errEl.classList.add("hidden")
  errEl.hidden = true
  root.classList.add("hidden")
  root.hidden = true
  ph.classList.remove("hidden")
  if (statusEl) statusEl.textContent = ""

  const originIn = form.elements.origin
  const destIn = form.elements.destination
  originIn.value = originIn.value.trim().toUpperCase().slice(0, 3)
  destIn.value = destIn.value.trim().toUpperCase().slice(0, 3)

  ph.textContent = LOADING_HINT

  if (overviewEl) {
    overviewEl.replaceChildren()
    overviewEl.classList.add("hidden")
    overviewEl.hidden = true
  }

  const fd = new FormData(form)
  const sources = []
  if (fd.get("srcSky")) sources.push("skyscanner")
  if (fd.get("srcKiwi")) sources.push("kiwi")

  const body = {
    origin: fd.get("origin"),
    destination: fd.get("destination"),
    departureDate: fd.get("departureDate"),
    returnDate: fd.get("roundTrip") ? fd.get("returnDate") : undefined,
    sources,
    mode: fd.get("mode"),
  }

  btn.disabled = true
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
    renderResults(data)
    ph.classList.add("hidden")
    root.classList.remove("hidden")
    root.hidden = false
    requestAnimationFrame(() => {
      resultsPanel?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  } catch (err) {
    if (overviewEl) {
      overviewEl.replaceChildren()
      overviewEl.classList.add("hidden")
      overviewEl.hidden = true
    }
    errEl.textContent = err.message || String(err)
    errEl.classList.remove("hidden")
    errEl.hidden = false
    ph.textContent = IDLE_PLACEHOLDER
    ph.classList.remove("hidden")
  } finally {
    btn.disabled = false
    btn.setAttribute("aria-busy", "false")
    btn.textContent = "Search flights"
  }
})

/** Merge successful API blocks into one graph (dedupe by entity id; first wins). */
function mergeSuccessfulSources(successBlocks) {
  const dealsById = new Map()
  const flightsById = new Map()
  const legsById = new Map()
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

function fillResultsOverview(summary) {
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

function renderResults(payload) {
  root.innerHTML = ""

  const sources = Array.isArray(payload.sources) ? payload.sources : []
  const failures = []
  const successes = []
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
    root.appendChild(wrap)
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
  root.appendChild(wrap)

  if (statusEl) {
    statusEl.textContent = announcements.length ? announcements.join(". ") + "." : ""
  }
}

function minDealPrice(deals) {
  if (!deals?.length) return Number.POSITIVE_INFINITY
  return Math.min(...deals.map((d) => d.price))
}

/** Trip order: cheapest “best offer” in the trip first (min deal price), then stable tie-break. */
function sortTripIdsByMinDealPrice(dealsByTrip) {
  return [...dealsByTrip.keys()].sort((a, b) => {
    const pa = minDealPrice(dealsByTrip.get(a))
    const pb = minDealPrice(dealsByTrip.get(b))
    if (pa !== pb) return pa - pb
    return String(a).localeCompare(String(b))
  })
}

function groupDealsByTrip(deals) {
  const m = new Map()
  for (const d of deals) {
    if (!m.has(d.trip)) m.set(d.trip, [])
    m.get(d.trip).push(d)
  }
  return m
}

function sortLegs(legs, inbound) {
  return legs.filter((l) => l.inbound === inbound).sort((a, b) => a.order - b.order)
}

function bestDealPriceCents(deals) {
  const list = Array.isArray(deals) ? deals : []
  if (list.length === 0) return null
  return Math.min(...list.map((d) => d.price))
}

function renderTripCard(tripId, allLegs, flightById, deals) {
  const dealList = Array.isArray(deals) ? deals : []

  const card = document.createElement("article")
  card.className = "trip-card"

  const legsForTrip = allLegs.filter((l) => l.trip === tripId)
  const outbound = sortLegs(legsForTrip, false)
  const inbound = sortLegs(legsForTrip, true)

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
    if (inbound.length > 0) {
      itin.classList.add("has-return")
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

function renderDirection(label, legs, flightById) {
  const wrap = document.createElement("section")
  wrap.className = "trip-direction"
  const h = document.createElement("h4")
  h.className = "trip-direction-title"
  h.textContent = label
  const ol = document.createElement("ol")
  ol.className = "leg-list"
  for (const leg of legs) {
    ol.appendChild(renderLegItem(leg, flightById.get(leg.flight)))
  }
  wrap.append(h, ol)
  return wrap
}

function renderLegItem(leg, flight) {
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

function layoverEl(minutes) {
  const d = document.createElement("div")
  d.className = "leg-layover"
  d.textContent = `Layover ${minutes} min`
  return d
}

function renderDealChip(deal) {
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

function shortId(id) {
  const s = String(id)
  return s.length <= 14 ? s : `${s.slice(0, 12)}…`
}

function titleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
