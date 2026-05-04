export type UiFlight = {
  from: string
  to: string
  dep: string
  arr: string
  airline: string
  fn: string
  dur: number
  conn: number | null
}

export type UiItinerary = {
  date: string
  duration: number
  layover: number
  flights: UiFlight[]
}

export type UiDeal = {
  provider: string
  price: number
  link: string
}

export type UiTrip = {
  id: string
  price: number
  currency: string
  deals: UiDeal[]
  outbound: UiItinerary
  inbound?: UiItinerary
  stats: { duration: number; stops: number; layover: number }
}

type ApiLeg = {
  id: string; trip: string; flight: string
  inbound: boolean; order: number; connection_time?: number | null
}
type ApiFlight = {
  id: string; airline: string; flight_number: string
  origin: string; destination: string
  departure_date: string; departure_time: string
  arrival_date?: string; arrival_time: string; duration: number
}
type ApiDeal = {
  id: string; trip: string; price: number; provider: string; link: string
  source?: string
}

type SourceBlock = {
  deals: ApiDeal[]
  legs: ApiLeg[]
  flights: ApiFlight[]
}

export type ApiPayload = {
  mode?: string
  input?: { origin?: string; destination?: string; departureDate?: string; returnDate?: string }
  sources?: Array<({ ok: true; source: string } & SourceBlock) | { ok: false; source: string; error: string }>
  // fixture/demo shape: { data: { deals, legs, flights, trips }, metadata }
  data?: { deals?: ApiDeal[]; legs?: ApiLeg[]; flights?: ApiFlight[]; trips?: { id: string }[] }
  metadata?: Record<string, unknown>
}

function centsToEuros(cents: number): number {
  return cents / 100
}

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function normalizeBlocks(payload: ApiPayload): SourceBlock[] {
  if (payload.sources) {
    return payload.sources
      .filter((s): s is { ok: true; source: string } & SourceBlock => s.ok)
      .map(s => ({ deals: s.deals ?? [], legs: s.legs ?? [], flights: s.flights ?? [] }))
  }
  if (payload.data) {
    return [{ deals: payload.data.deals ?? [], legs: payload.data.legs ?? [], flights: payload.data.flights ?? [] }]
  }
  return []
}

export function transformApiResponse(payload: ApiPayload): UiTrip[] {
  const blocks = normalizeBlocks(payload)

  const dealsByTrip = new Map<string, Map<string, UiDeal>>()
  const legsByTrip = new Map<string, ApiLeg[]>()
  const flightsById = new Map<string, ApiFlight>()

  for (const blk of blocks) {
    for (const f of blk.flights) flightsById.set(f.id, f)
    for (const deal of blk.deals) {
      if (!dealsByTrip.has(deal.trip)) dealsByTrip.set(deal.trip, new Map())
      const euroPrice = centsToEuros(deal.price)
      const key = `${deal.provider}::${euroPrice}`
      dealsByTrip.get(deal.trip)!.set(key, { provider: deal.provider, price: euroPrice, link: deal.link })
    }
    for (const leg of blk.legs) {
      if (!legsByTrip.has(leg.trip)) legsByTrip.set(leg.trip, [])
      legsByTrip.get(leg.trip)!.push(leg)
    }
  }

  const trips: UiTrip[] = []

  for (const [tripId, dealsMap] of dealsByTrip) {
    const legs = legsByTrip.get(tripId) ?? []
    const outLegs = legs.filter(l => !l.inbound).sort((a, b) => a.order - b.order)
    const inLegs  = legs.filter(l =>  l.inbound).sort((a, b) => a.order - b.order)

    const buildItin = (legSet: ApiLeg[]): UiItinerary | null => {
      if (legSet.length === 0) return null
      const uiFlights: UiFlight[] = []
      for (const leg of legSet) {
        const f = flightsById.get(leg.flight)
        if (!f) continue
        const overnight = f.arrival_date && f.arrival_date !== f.departure_date
        uiFlights.push({
          from: f.origin,
          to: f.destination,
          dep: f.departure_time.slice(0, 5),
          arr: overnight ? `${f.arrival_time.slice(0, 5)}+1` : f.arrival_time.slice(0, 5),
          airline: f.airline,
          fn: f.flight_number,
          dur: f.duration,
          conn: leg.connection_time ?? null,
        })
      }
      if (uiFlights.length === 0) return null
      const firstF = flightsById.get(legSet[0].flight)
      const duration = uiFlights.reduce((acc, fl, i) =>
        acc + fl.dur + (i < uiFlights.length - 1 && fl.conn ? fl.conn : 0), 0)
      const layover = uiFlights.slice(0, -1).reduce((acc, fl) => acc + (fl.conn ?? 0), 0)
      return { date: firstF ? fmtDate(firstF.departure_date) : '', duration, layover, flights: uiFlights }
    }

    const outbound = buildItin(outLegs)
    if (!outbound) continue
    const inbound = buildItin(inLegs) ?? undefined

    const sortedDeals = [...dealsMap.values()].sort((a, b) => a.price - b.price)
    const stops = (outbound.flights.length - 1) + (inbound ? inbound.flights.length - 1 : 0)

    trips.push({
      id: tripId,
      price: sortedDeals[0]?.price ?? 0,
      currency: 'EUR',
      deals: sortedDeals,
      outbound,
      inbound,
      stats: {
        duration: outbound.duration + (inbound?.duration ?? 0),
        stops,
        layover: outbound.layover + (inbound?.layover ?? 0),
      },
    })
  }

  return trips.sort((a, b) => a.price - b.price)
}
