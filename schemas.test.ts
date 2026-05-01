import { test, expect } from "bun:test"
import { Deal, Flight, Leg, Trip, dedupeParsedDealsData } from "./schemas"

const ts = "2026-01-15T12:00:00Z"

test("dedupeParsedDealsData keeps first row per id", () => {
  const tripFirst = new Trip({ id: "aaa", created_at: ts })
  const tripDup = new Trip({ id: "aaa", created_at: "2026-06-01T00:00:00Z" })

  const flightFirst = new Flight({
    id: "f1",
    flight_number: "KL1770",
    airline: "KLM",
    origin: "BER",
    destination: "AMS",
    departure_date: "2026-02-01",
    departure_time: "06:00",
    arrival_date: "2026-02-01",
    arrival_time: "07:25",
    duration: 85,
    created_at: ts,
  })
  const flightDup = new Flight({
    id: "f1",
    flight_number: "KL1770",
    airline: "KLM",
    origin: "BER",
    destination: "AMS",
    departure_date: "2026-02-01",
    departure_time: "06:00",
    arrival_date: "2026-02-01",
    arrival_time: "07:25",
    duration: 999,
    created_at: ts,
  })

  const legFirst = new Leg({
    id: "aaa_outbound_f1",
    trip: "aaa",
    flight: "f1",
    inbound: false,
    order: 0,
    connection_time: null,
    created_at: ts,
  })
  const legDup = new Leg({
    id: "aaa_outbound_f1",
    trip: "aaa",
    flight: "f1",
    inbound: false,
    order: 0,
    connection_time: 60,
    created_at: ts,
  })

  const dealFirst = new Deal({
    id: "aaa_skyscanner_KLM_0",
    trip: "aaa",
    origin: "BER",
    destination: "MAD",
    departure_date: "2026-02-01",
    departure_time: "06:00",
    return_date: "2026-02-04",
    return_time: "06:00",
    source: "skyscanner",
    provider: "KLM",
    price: 32900,
    link: "https://example.com/a",
    created_at: ts,
    updated_at: ts,
  })
  const dealDup = new Deal({
    id: "aaa_skyscanner_KLM_0",
    trip: "aaa",
    origin: "BER",
    destination: "MAD",
    departure_date: "2026-02-01",
    departure_time: "06:00",
    return_date: "2026-02-04",
    return_time: "06:00",
    source: "skyscanner",
    provider: "KLM",
    price: 99999,
    link: "https://example.com/b",
    created_at: ts,
    updated_at: ts,
  })

  const out = dedupeParsedDealsData({
    trips: [tripFirst, tripDup],
    flights: [
      flightFirst,
      flightDup,
      new Flight({
        id: "f2",
        flight_number: "KL1503",
        airline: "KLM",
        origin: "AMS",
        destination: "MAD",
        departure_date: "2026-02-01",
        departure_time: "09:45",
        arrival_date: "2026-02-01",
        arrival_time: "12:10",
        duration: 145,
        created_at: ts,
      }),
    ],
    legs: [legFirst, legDup],
    deals: [
      dealFirst,
      dealDup,
      new Deal({
        id: "aaa_skyscanner_AF_1",
        trip: "aaa",
        origin: "BER",
        destination: "MAD",
        departure_date: "2026-02-01",
        departure_time: "06:00",
        return_date: "2026-02-04",
        return_time: "06:00",
        source: "skyscanner",
        provider: "Air France",
        price: 33000,
        link: "https://example.com/c",
        created_at: ts,
        updated_at: ts,
      }),
    ],
  })

  expect(out.trips).toHaveLength(1)
  expect(out.trips[0]!.created_at).toBe(ts)

  expect(out.flights).toHaveLength(2)
  expect(out.flights.find((f) => f.id === "f1")!.duration).toBe(85)

  expect(out.legs).toHaveLength(1)
  expect(out.legs[0]!.connection_time).toBe(null)

  expect(out.deals).toHaveLength(2)
  expect(out.deals.find((d) => d.id === "aaa_skyscanner_KLM_0")!.price).toBe(32900)
})
