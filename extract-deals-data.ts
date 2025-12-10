import { Effect } from "effect"
import * as cheerio from "cheerio"
import { createHash } from "node:crypto"
import { DateTime } from "effect"

/**
 * Deal interface
 */
export interface Deal {
  id: string // Generated as: `${tripId}_skyscanner_${provider}`
  trip: string // Foreign key → trips.id
  origin: string
  destination: string
  is_round: boolean
  departure_date: string // ISO date string (YYYY-MM-DD)
  departure_time: string // Time string (HH:MM)
  return_date: string | null // ISO date string (YYYY-MM-DD) or null
  return_time: string | null // Time string (HH:MM) or null
  source: string
  provider: string
  price: number // float (real)
  link: string
  created_at: string // ISO timestamp string
  updated_at: string // ISO timestamp string
}

/**
 * Flight interface
 */
export interface Flight {
  id: string // Generated as: `${flightNumber}_${origin}_${departureDate}_${departureTime}`
  flight_number: string
  airline: string
  origin: string
  destination: string
  departure_date: string // ISO date string (YYYY-MM-DD)
  departure_time: string // Time string (HH:MM)
  arrival_date: string // ISO date string (YYYY-MM-DD)
  arrival_time: string // Time string (HH:MM)
  duration: number // smallint (minutes)
  created_at: string // ISO timestamp string
}

/**
 * Leg interface
 */
export interface Leg {
  id: string // Generated as: `${tripId}_outbound_${flightId}` or `${tripId}_inbound_${flightId}`
  trip: string // Foreign key → trips.id
  flight: string // Foreign key → flights.id
  inbound: boolean
  order: number // Order within the trip (0-based)
  connection_time: number | null // Minutes between flights, or null for last leg
  created_at: string // ISO timestamp string
}

/**
 * Trip interface
 */
export interface Trip {
  id: string // Generated as: SHA-256 hash of sorted flight IDs joined by `|`
  created_at: string // ISO timestamp string
}

/**
 * Extracted data from resultsHtml
 */
export interface ExtractedDealsData {
  deals: Deal[]
  flights: Flight[]
  legs: Leg[]
  trips: Trip[]
}

/**
 * Helper function to parse date from text like "Sun, 1 Feb 2026"
 */
const parseDate = (dateText: string): string | null => {
  const match = dateText.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/)
  if (!match) return null

  const [, day, monthName, year] = match
  if (!day || !monthName || !year) return null

  const monthMap: Record<string, string> = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12",
  }
  const month = monthMap[monthName.substring(0, 3)]
  if (!month) return null

  return `${year}-${month}-${day.padStart(2, "0")}`
}

/**
 * Helper function to parse duration from text like "1h 25" or "2h 30"
 */
const parseDuration = (durationText: string): number => {
  const match = durationText.match(/(\d+)h\s*(\d+)?/)
  if (!match) return 0
  const hours = Number.parseInt(match[1] || "0", 10)
  const minutes = Number.parseInt(match[2] || "0", 10)
  return hours * 60 + minutes
}

/**
 * Helper function to parse connection time from text like "2h 20 Connect in airport"
 */
const parseConnectionTime = (text: string): number | null => {
  const match = text.match(/(\d+)h\s*(\d+)?/)
  if (!match) return null
  const hours = Number.parseInt(match[1] || "0", 10)
  const minutes = Number.parseInt(match[2] || "0", 10)
  return hours * 60 + minutes
}

/**
 * Helper function to generate SHA-256 hash
 */
const sha256 = (text: string): string => {
  return createHash("sha256").update(text).digest("hex")
}

/**
 * Extracts deals, flights, legs, and trips from resultsHtml string
 */
export const extractDealsData = (
  resultsHtml: string,
  origin: string, // Origin airport code
  destination: string, // Destination airport code
  departureDate: string, // ISO date string (YYYY-MM-DD)
  returnDate: string | null = null // ISO date string (YYYY-MM-DD) or null
): Effect.Effect<ExtractedDealsData, Error> =>
  Effect.gen(function* () {
    const $ = cheerio.load(resultsHtml)
    const now = yield* DateTime.now
    const nowIso = DateTime.formatIso(now)

    const deals: Deal[] = []
    const flights: Flight[] = []
    const legs: Leg[] = []
    const trips: Trip[] = []

    // Find all modal divs
    const modals = $('div.modal[id^="myModal"]').toArray()

    for (const modal of modals) {
      const $modal = $(modal)
      const modalId = $modal.attr("id") || ""

      // Find the corresponding list-item to get price and link
      const listItem = $(`.list-item a[onclick*="${modalId}"]`).closest(".list-item")
      const priceText = listItem.find(".prices").text().trim()
      const priceMatch = priceText.match(/€(\d+)/)
      const price = priceMatch && priceMatch[1] ? Number.parseFloat(priceMatch[1]) * 100 : 0 // Convert to cents

      const link = listItem.find('a[href^="https://agw.skyscnr.com"]').first().attr("href") || ""

      // Extract outbound and return sections
      const outboundSection = $modal.find('p._heading:contains("Outbound")').parent()
      const returnSection = $modal.find('p._heading:contains("Return")').parent()

      // Extract outbound date
      const outboundDateText = outboundSection.find("p._heading").text()
      const outboundDate = parseDate(outboundDateText) || departureDate

      // Extract return date if exists
      let returnDateParsed: string | null = null
      if (returnSection.length > 0) {
        const returnDateText = returnSection.find("p._heading").text()
        returnDateParsed = parseDate(returnDateText) || returnDate
      }

      // Extract provider from "Book Your Ticket" section
      const providerSection = $modal.find('p._heading:contains("Book Your Ticket")').parent()
      const providerName = providerSection.find("._similar > div > p").first().text().trim() || "Unknown"

      // Extract all flights from outbound
      const outboundFlights: Flight[] = []
      const outboundPanels = outboundSection.find("._panel_body").toArray()

      for (const panel of outboundPanels) {
        const $panel = $(panel)
        const flightNumberText = $panel.find("._head small").text().trim()
        const flightMatch = flightNumberText.match(/(\w+)\s+(\w+)/)
        if (!flightMatch || !flightMatch[1] || !flightMatch[2]) continue

        const airline = flightMatch[1]
        const flightNumber = `${airline} ${flightMatch[2]}`

        const $item = $panel.find("._item")
        const times = $item.find(".c3 p").toArray().map((el) => $(el).text().trim())
        const airports = $item.find(".c4 p").toArray().map((el) => $(el).text().trim())
        const durationText = $item.find(".c1 p").text().trim()

        if (times.length < 2 || airports.length < 2) continue

        const departureTime = times[0]
        const arrivalTime = times[1]
        const originAirport = airports[0]?.split(" ")[0] // Get airport code
        const destAirport = airports[1]?.split(" ")[0]

        if (!departureTime || !arrivalTime || !originAirport || !destAirport) continue

        // Calculate arrival date (same day for now, could be next day for long flights)
        const arrivalDate = outboundDate

        const duration = parseDuration(durationText)

        const flightId = `${flightNumber.replace(/\s+/g, "_")}_${originAirport}_${outboundDate}_${departureTime.replace(":", "-")}`

        const flight: Flight = {
          id: flightId,
          flight_number: flightNumber,
          airline,
          origin: originAirport,
          destination: destAirport,
          departure_date: outboundDate,
          departure_time: departureTime,
          arrival_date: arrivalDate,
          arrival_time: arrivalTime,
          duration,
          created_at: nowIso,
        }

        flights.push(flight)
        outboundFlights.push(flight)
      }

      // Extract all flights from return
      const returnFlights: Flight[] = []
      if (returnSection.length > 0) {
        const returnPanels = returnSection.find("._panel_body").toArray()

        for (const panel of returnPanels) {
          const $panel = $(panel)
          const flightNumberText = $panel.find("._head small").text().trim()
          const flightMatch = flightNumberText.match(/(\w+)\s+(\w+)/)
          if (!flightMatch || !flightMatch[1] || !flightMatch[2]) continue

          const airline = flightMatch[1]
          const flightNumber = `${airline} ${flightMatch[2]}`

          const $item = $panel.find("._item")
          const times = $item.find(".c3 p").toArray().map((el) => $(el).text().trim())
          const airports = $item.find(".c4 p").toArray().map((el) => $(el).text().trim())
          const durationText = $item.find(".c1 p").text().trim()

          if (times.length < 2 || airports.length < 2) continue

          const departureTime = times[0]
          const arrivalTime = times[1]
          const originAirport = airports[0]?.split(" ")[0]
          const destAirport = airports[1]?.split(" ")[0]

          if (!departureTime || !arrivalTime || !originAirport || !destAirport) continue

          const arrivalDate = returnDateParsed || returnDate || outboundDate
          const flightDate = returnDateParsed || returnDate || outboundDate

          const duration = parseDuration(durationText)

          const flightId = `${flightNumber.replace(/\s+/g, "_")}_${originAirport}_${flightDate}_${departureTime.replace(":", "-")}`

          const flight: Flight = {
            id: flightId,
            flight_number: flightNumber,
            airline,
            origin: originAirport,
            destination: destAirport,
            departure_date: flightDate,
            departure_time: departureTime,
            arrival_date: arrivalDate,
            arrival_time: arrivalTime,
            duration,
            created_at: nowIso,
          }

          flights.push(flight)
          returnFlights.push(flight)
        }
      }

      // Generate trip ID from sorted flight IDs
      const allFlightIds = [...outboundFlights, ...returnFlights].map((f) => f.id).sort()
      const tripIdHash = sha256(allFlightIds.join("|"))

      // Create trip
      const trip: Trip = {
        id: tripIdHash,
        created_at: nowIso,
      }
      trips.push(trip)

      // Create legs for outbound flights
      for (let i = 0; i < outboundFlights.length; i++) {
        const flight = outboundFlights[i]
        if (!flight) continue

        const connectionTime =
          i < outboundFlights.length - 1
            ? parseConnectionTime(
                outboundSection.find("._panel_body").eq(i).find(".connect_airport").text()
              )
            : null

        const leg: Leg = {
          id: `${tripIdHash}_outbound_${flight.id}`,
          trip: tripIdHash,
          flight: flight.id,
          inbound: false,
          order: i,
          connection_time: connectionTime,
          created_at: nowIso,
        }
        legs.push(leg)
      }

      // Create legs for return flights
      for (let i = 0; i < returnFlights.length; i++) {
        const flight = returnFlights[i]
        if (!flight) continue

        const connectionTime =
          i < returnFlights.length - 1
            ? parseConnectionTime(
                returnSection.find("._panel_body").eq(i).find(".connect_airport").text()
              )
            : null

        const leg: Leg = {
          id: `${tripIdHash}_inbound_${flight.id}`,
          trip: tripIdHash,
          flight: flight.id,
          inbound: true,
          order: i,
          connection_time: connectionTime,
          created_at: nowIso,
        }
        legs.push(leg)
      }

      // Get first outbound flight for departure time
      const firstOutboundFlight = outboundFlights[0]
      const lastReturnFlight = returnFlights.length > 0 ? returnFlights[returnFlights.length - 1] : null

      // Create deal
      const deal: Deal = {
        id: `${tripIdHash}_skyscanner_${providerName.replace(/\s+/g, "_")}`,
        trip: tripIdHash,
        origin,
        destination,
        is_round: returnFlights.length > 0,
        departure_date: outboundDate,
        departure_time: firstOutboundFlight?.departure_time || "",
        return_date: returnDateParsed,
        return_time: lastReturnFlight?.arrival_time || null,
        source: "skyscanner",
        provider: providerName,
        price,
        link,
        created_at: nowIso,
        updated_at: nowIso,
      }
      deals.push(deal)
    }

    return {
      deals,
      flights,
      legs,
      trips,
    }
  })

