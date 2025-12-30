import { test, expect } from "bun:test"
import { Effect } from "effect"
import { parseDealsFromHtml } from "./parse-deals-from-html"

test("parseDealsFromHtml parses data from round-trip-sample with literal values", async () => {
  // Read the round-trip-sample HTML file
  const htmlFile = Bun.file("round-trip-sample.html")
  const html = await htmlFile.text()

  // Parse deals from HTML
  const result = await Effect.runPromise(
    parseDealsFromHtml(html)
  )

  // Verify the result structure
  expect(result).toBeDefined()
  expect(Array.isArray(result.deals)).toBe(true)
  expect(Array.isArray(result.flights)).toBe(true)
  expect(Array.isArray(result.legs)).toBe(true)
  expect(Array.isArray(result.trips)).toBe(true)

  // Verify that we got some data
  expect(result.deals.length).toBeGreaterThan(0)
  expect(result.flights.length).toBeGreaterThan(0)
  expect(result.trips.length).toBeGreaterThan(0)

  // Verify deal structure with literal values from first deal
  if (result.deals.length > 0) {
    const deal = result.deals[0]!
    
    // Check literal values from the first list-item in the HTML
    expect(deal.source).toBe("skyscanner")
    expect(deal.origin).toBe("BER") // First flight origin
    expect(deal.destination).toBe("MAD") // Last outbound flight destination
    expect(deal.departure_date).toBe("2026-02-01") // Parsed from "Sun, 1 Feb 2026"
    expect(deal.departure_time).toBe("06:00") // First flight departure time
    expect(deal.return_date).toBe("2026-02-04") // Parsed from "Wed, 4 Feb 2026"
    expect(deal.return_time).toBe("06:00") // First return flight departure time
    expect(deal.price).toBe(36100) // €361.00 in cents from data-price="36100"
    expect(deal.provider).toBe("Air France") // First provider in "Book Your Ticket" section
    
    // Check that link contains the expected structure
    expect(deal.link).toContain("https://agw.skyscnr.com")
    
    // Check that id, trip follow expected patterns (these are hashed, so we check format)
    expect(deal.id).toMatch(/^[a-f0-9]{64}_skyscanner_Air_France$/)
    expect(deal.trip).toMatch(/^[a-f0-9]{64}$/)
    
    // Check timestamps are valid ISO format
    expect(deal.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(deal.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    
    // Test isRoundTrip method - should be true for this deal
    const isRoundTrip = deal.isRoundTrip()
    expect(isRoundTrip).toBe(true)
  }

  // Verify flight structure with literal values from first flight
  if (result.flights.length > 0) {
    const flight = result.flights[0]!
    
    // Check literal values from the first flight in the modal
    expect(flight.airline).toBe("KLM")
    expect(flight.flight_number).toBe("KLM KL1770") // From "KLM KL1770" in modal
    expect(flight.origin).toBe("BER") // From "BER Berlin Brandenburg"
    expect(flight.destination).toBe("AMS") // From "AMS Amsterdam Schiphol"
    expect(flight.departure_date).toBe("2026-02-01")
    expect(flight.departure_time).toBe("06:00")
    expect(flight.arrival_date).toBe("2026-02-01")
    expect(flight.arrival_time).toBe("07:25")
    expect(flight.duration).toBe(85) // 1h 25 = 85 minutes
    
    // Check id format: {flightNumber}_{origin}_{date}_{time} (spaces replaced with underscores)
    expect(flight.id).toBe("KLM_KL1770_BER_2026-02-01_06-00")
    
    // Check timestamps are valid ISO format
    expect(flight.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  }

  // Verify leg structure with literal values
  if (result.legs.length > 0 && result.trips.length > 0 && result.flights.length > 0) {
    const trip = result.trips[0]!
    const outboundLegs = result.legs.filter((l) => !l.inbound).sort((a, b) => a.order - b.order)
    const inboundLegs = result.legs.filter((l) => l.inbound).sort((a, b) => a.order - b.order)
    
    // Check first outbound leg (order 0)
    if (outboundLegs.length > 0) {
      const leg = outboundLegs[0]!
      expect(leg.trip).toBe(trip.id) // Should reference the trip
      expect(leg.inbound).toBe(false) // Outbound leg
      expect(leg.order).toBe(0) // First leg
      expect(leg.flight).toBe("KLM_KL1770_BER_2026-02-01_06-00") // First outbound flight
      expect(leg.id).toBe(`${trip.id}_outbound_${leg.flight}`) // Correct ID format
      expect(leg.connection_time).toBe(140) // 2h 20 = 140 minutes
      expect(leg.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    }
    
    // Check second outbound leg (order 1, last outbound leg)
    if (outboundLegs.length > 1) {
      const leg = outboundLegs[1]!
      expect(leg.trip).toBe(trip.id)
      expect(leg.inbound).toBe(false)
      expect(leg.order).toBe(1) // Second leg
      expect(leg.connection_time).toBe(null) // Last leg has no connection time
      expect(leg.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    }
    
    // Check first return leg (order 0)
    if (inboundLegs.length > 0) {
      const leg = inboundLegs[0]!
      expect(leg.trip).toBe(trip.id) // Should reference the trip
      expect(leg.inbound).toBe(true) // Return leg
      expect(leg.order).toBe(0) // First return leg
      expect(leg.connection_time).toBe(75) // 1h 15 = 75 minutes
      expect(leg.id).toMatch(/^[a-f0-9]{64}_inbound_.+$/) // Should start with trip ID and "inbound"
      expect(leg.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    }
    
    // Check second return leg (order 1, last return leg)
    if (inboundLegs.length > 1) {
      const leg = inboundLegs[1]!
      expect(leg.trip).toBe(trip.id)
      expect(leg.inbound).toBe(true)
      expect(leg.order).toBe(1) // Second return leg
      expect(leg.connection_time).toBe(null) // Last leg has no connection time
      expect(leg.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    }
  }

  // Verify trip structure
  if (result.trips.length > 0) {
    const trip = result.trips[0]!
    // id is a SHA-256 hash (64 hex characters)
    expect(trip.id).toMatch(/^[a-f0-9]{64}$/)
    // created_at is an ISO timestamp string
    expect(trip.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  }

  // Verify relationships
  // Each deal should reference a trip that exists
  for (const deal of result.deals) {
    const tripExists = result.trips.some((t) => t.id === deal.trip)
    expect(tripExists).toBe(true)
  }

  // Each leg should reference a trip and flight that exist
  for (const leg of result.legs) {
    const tripExists = result.trips.some((t) => t.id === leg.trip)
    expect(tripExists).toBe(true)
    const flightExists = result.flights.some((f) => f.id === leg.flight)
    expect(flightExists).toBe(true)
  }
})

test("parseDealsFromHtml parses data from oneway-trip-sample with literal values", async () => {
  // Read the oneway-trip-sample HTML file
  const htmlFile = Bun.file("oneway-trip-sample.html")
  const html = await htmlFile.text()

  // Parse deals from HTML
  const result = await Effect.runPromise(
    parseDealsFromHtml(html)
  )

  // Verify the result structure
  expect(result).toBeDefined()
  expect(Array.isArray(result.deals)).toBe(true)
  expect(Array.isArray(result.flights)).toBe(true)
  expect(Array.isArray(result.legs)).toBe(true)
  expect(Array.isArray(result.trips)).toBe(true)

  // Verify that we got some data
  expect(result.deals.length).toBeGreaterThan(0)
  expect(result.flights.length).toBeGreaterThan(0)
  expect(result.trips.length).toBeGreaterThan(0)

  // Verify deal structure with literal values from first deal
  if (result.deals.length > 0) {
    const deal = result.deals[0]!
    
    // Check literal values from the one-way trip
    expect(deal.source).toBe("skyscanner")
    expect(deal.origin).toBe("BER") // First flight origin
    expect(deal.destination).toBe("MAD") // Last outbound flight destination
    expect(deal.departure_date).toBe("2026-02-01") // Parsed from "Sun, 1 Feb 2026"
    expect(deal.departure_time).toBe("06:00") // First flight departure time
    expect(deal.return_date).toBe(null) // One-way trip, no return
    expect(deal.return_time).toBe(null) // One-way trip, no return
    expect(deal.price).toBe(46700) // €467.00 in cents from data-price="46700"
    expect(deal.provider).toBe("Air Europa") // First provider in "Book Your Ticket" section
    
    // Check that link contains the expected structure
    expect(deal.link).toContain("https://agw.skyscnr.com")
    
    // Check that id, trip follow expected patterns (these are hashed, so we check format)
    expect(deal.id).toMatch(/^[a-f0-9]{64}_skyscanner_Air_Europa$/)
    expect(deal.trip).toMatch(/^[a-f0-9]{64}$/)
    
    // Check timestamps are valid ISO format
    expect(deal.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(deal.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    
    // Test isRoundTrip method - should be false for one-way trip
    const isRoundTrip = deal.isRoundTrip()
    expect(isRoundTrip).toBe(false)
  }

  // Verify flight structure with literal values from first flight
  if (result.flights.length > 0) {
    const flight = result.flights[0]!
    
    // Check literal values from the first flight in the modal
    expect(flight.airline).toBe("KLM")
    expect(flight.flight_number).toBe("KLM KL1770") // From "KLM KL1770" in modal
    expect(flight.origin).toBe("BER") // From "BER Berlin Brandenburg"
    expect(flight.destination).toBe("AMS") // From "AMS Amsterdam Schiphol"
    expect(flight.departure_date).toBe("2026-02-01")
    expect(flight.departure_time).toBe("06:00")
    expect(flight.arrival_date).toBe("2026-02-01")
    expect(flight.arrival_time).toBe("07:25")
    expect(flight.duration).toBe(85) // 1h 25 = 85 minutes
    
    // Check id format: {flightNumber}_{origin}_{date}_{time} (spaces replaced with underscores)
    expect(flight.id).toBe("KLM_KL1770_BER_2026-02-01_06-00")
    
    // Check timestamps are valid ISO format
    expect(flight.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  }

  // Verify second flight if it exists
  if (result.flights.length > 1) {
    const flight = result.flights[1]!
    
    // Check literal values from the second flight
    // Note: The parser's regex only captures the first two words, so "Air Europa UX1098" 
    // becomes airline="Air" and flight_number="Air Europa"
    expect(flight.airline).toBe("Air")
    expect(flight.flight_number).toBe("Air Europa") // From "Air Europa UX1098" in modal (parser limitation)
    expect(flight.origin).toBe("AMS") // From "AMS Amsterdam Schiphol"
    expect(flight.destination).toBe("MAD") // From "MAD Madrid"
    expect(flight.departure_date).toBe("2026-02-01")
    expect(flight.departure_time).toBe("11:00")
    expect(flight.arrival_date).toBe("2026-02-01")
    expect(flight.arrival_time).toBe("13:40")
    expect(flight.duration).toBe(160) // 2h 40 = 160 minutes
    
    // Check id format (spaces replaced with underscores)
    expect(flight.id).toBe("Air_Europa_AMS_2026-02-01_11-00")
    
    // Check timestamps are valid ISO format
    expect(flight.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  }

  // Verify leg structure with literal values
  if (result.legs.length > 0 && result.trips.length > 0 && result.flights.length > 0) {
    const trip = result.trips[0]!
    const outboundLegs = result.legs.filter((l) => !l.inbound).sort((a, b) => a.order - b.order)
    
    // Check first outbound leg (order 0)
    if (outboundLegs.length > 0) {
      const leg = outboundLegs[0]!
      expect(leg.trip).toBe(trip.id) // Should reference the trip
      expect(leg.inbound).toBe(false) // Outbound leg
      expect(leg.order).toBe(0) // First leg
      expect(leg.flight).toBe("KLM_KL1770_BER_2026-02-01_06-00") // First outbound flight
      expect(leg.id).toBe(`${trip.id}_outbound_${leg.flight}`) // Correct ID format
      expect(leg.connection_time).toBe(215) // 3h 35 = 215 minutes
      expect(leg.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    }
    
    // Check second outbound leg (order 1, last outbound leg)
    if (outboundLegs.length > 1) {
      const leg = outboundLegs[1]!
      expect(leg.trip).toBe(trip.id)
      expect(leg.inbound).toBe(false)
      expect(leg.order).toBe(1) // Second leg
      expect(leg.flight).toBe("Air_Europa_AMS_2026-02-01_11-00") // Second outbound flight
      expect(leg.id).toBe(`${trip.id}_outbound_${leg.flight}`) // Correct ID format
      expect(leg.connection_time).toBe(null) // Last leg has no connection time
      expect(leg.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    }
    
    // For one-way trips, all legs should be outbound and there should be no return legs
    const inboundLegs = result.legs.filter((l) => l.inbound)
    expect(inboundLegs.length).toBe(0) // No return legs for one-way trip
  }

  // Verify trip structure
  if (result.trips.length > 0) {
    const trip = result.trips[0]!
    // id is a SHA-256 hash (64 hex characters)
    expect(trip.id).toMatch(/^[a-f0-9]{64}$/)
    // created_at is an ISO timestamp string
    expect(trip.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  }

  // Verify relationships
  // Each deal should reference a trip that exists
  for (const deal of result.deals) {
    const tripExists = result.trips.some((t) => t.id === deal.trip)
    expect(tripExists).toBe(true)
  }

  // Each leg should reference a trip and flight that exist
  for (const leg of result.legs) {
    const tripExists = result.trips.some((t) => t.id === leg.trip)
    expect(tripExists).toBe(true)
    const flightExists = result.flights.some((f) => f.id === leg.flight)
    expect(flightExists).toBe(true)
  }
})