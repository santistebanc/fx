import { Effect, DateTime, Schema } from "effect"
import * as cheerio from "cheerio"
import { createHash } from "node:crypto"
import { Deal, Flight, Leg, Trip } from "../schemas"

/**
 * Result type containing arrays of deals, flights, legs, and trips
 */
export interface ParsedDealsData {
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
 * Parses resultsHtml from PollData and returns deals, flights, legs, and trips
 * 
 * @param resultsHtml - HTML string from PollData.resultsHtml
 * @returns An Effect that resolves to ParsedDealsData
 */
export const parseDealsFromHtml = (
  resultsHtml: string
): Effect.Effect<ParsedDealsData, Error> =>
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
      // For finding headings (dates), use parent to get the container
      const outboundSection = $modal.find('p._heading:contains("Outbound")').parent()
      const returnSection = $modal.find('p._heading:contains("Return")').parent()
      
      // For finding panel bodies (flights), use the _panel div that follows the heading
      const outboundHeading = $modal.find('p._heading:contains("Outbound")')
      const outboundPanel = outboundHeading.length > 0 ? outboundHeading.next('._panel').first() : null
      
      const returnHeading = $modal.find('p._heading:contains("Return")')
      const returnPanel = returnHeading.length > 0 ? returnHeading.next('._panel').first() : null

      // Extract outbound date
      const outboundDateText = outboundSection.find("p._heading").text()
      const outboundDate = parseDate(outboundDateText)
      if (!outboundDate) {
        return yield* Effect.fail(
          new Error(`Could not parse outbound date from: ${outboundDateText}`)
        )
      }

      // Extract return date if exists
      let returnDateParsed: string | null = null
      if (returnSection.length > 0) {
        // Get the return heading directly from the modal (same approach as outbound)
        const returnDateText = $modal.find('p._heading:contains("Return")').text()
        returnDateParsed = parseDate(returnDateText)
        if (!returnDateParsed) {
          return yield* Effect.fail(
            new Error(`Could not parse return date from: ${returnDateText}`)
          )
        }
      }

      // Extract provider from "Book Your Ticket" section
      const providerSection = $modal.find('p._heading:contains("Book Your Ticket")').parent()
      const providerName = providerSection.find("._similar > div > p").first().text().trim() || "Unknown"

      // Extract all flights from outbound
      const outboundFlights: Flight[] = []
      const outboundPanels = outboundPanel && outboundPanel.length > 0 
        ? outboundPanel.find("._panel_body").toArray()
        : outboundSection.find("._panel_body").toArray()

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

        const flightData = {
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

        // Validate and decode flight using schema
        const flight = yield* Schema.decodeUnknown(Flight)(flightData)
        flights.push(flight)
        outboundFlights.push(flight)
      }

      // Extract all flights from return
      const returnFlights: Flight[] = []
      if (returnSection.length > 0) {
        const returnPanels = returnPanel && returnPanel.length > 0
          ? returnPanel.find("._panel_body").toArray()
          : returnSection.find("._panel_body").toArray()

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

          const arrivalDate = returnDateParsed || outboundDate
          const flightDate = returnDateParsed || outboundDate

          const duration = parseDuration(durationText)

          const flightId = `${flightNumber.replace(/\s+/g, "_")}_${originAirport}_${flightDate}_${departureTime.replace(":", "-")}`

          const flightData = {
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

          // Validate and decode flight using schema
          const flight = yield* Schema.decodeUnknown(Flight)(flightData)
          flights.push(flight)
          returnFlights.push(flight)
        }
      }

      // Generate trip ID from sorted flight IDs
      const allFlightIds = [...outboundFlights, ...returnFlights].map((f) => f.id).sort()
      const tripIdHash = sha256(allFlightIds.join("|"))

      // Create trip
      const tripData = {
        id: tripIdHash,
        created_at: nowIso,
      }
      const trip = yield* Schema.decodeUnknown(Trip)(tripData)
      trips.push(trip)

      // Create legs for outbound flights
      for (let i = 0; i < outboundFlights.length; i++) {
        const flight = outboundFlights[i]
        if (!flight) continue

        const connectionTime =
          i < outboundFlights.length - 1
            ? parseConnectionTime(
                (outboundPanel && outboundPanel.length > 0
                  ? outboundPanel
                  : outboundSection).find("._panel_body").eq(i).find(".connect_airport").text()
              )
            : null

        const legData = {
          id: `${tripIdHash}_outbound_${flight.id}`,
          trip: tripIdHash,
          flight: flight.id,
          inbound: false,
          order: i,
          connection_time: connectionTime,
          created_at: nowIso,
        }
        const leg = yield* Schema.decodeUnknown(Leg)(legData)
        legs.push(leg)
      }

      // Create legs for return flights
      for (let i = 0; i < returnFlights.length; i++) {
        const flight = returnFlights[i]
        if (!flight) continue

        const connectionTime =
          i < returnFlights.length - 1
            ? parseConnectionTime(
                (returnPanel && returnPanel.length > 0
                  ? returnPanel
                  : returnSection).find("._panel_body").eq(i).find(".connect_airport").text()
              )
            : null

        const legData = {
          id: `${tripIdHash}_inbound_${flight.id}`,
          trip: tripIdHash,
          flight: flight.id,
          inbound: true,
          order: i,
          connection_time: connectionTime,
          created_at: nowIso,
        }
        const leg = yield* Schema.decodeUnknown(Leg)(legData)
        legs.push(leg)
      }

      // Get first outbound flight for departure time and origin/destination
      const firstOutboundFlight = outboundFlights[0]
      const firstReturnFlight = returnFlights.length > 0 ? returnFlights[0] : null

      if (!firstOutboundFlight) {
        return yield* Effect.fail(new Error("No outbound flights found in modal"))
      }

      // Extract origin from first outbound flight
      const origin = firstOutboundFlight.origin
      
      // Extract destination: prefer last outbound flight's destination, 
      // but also try to extract from list-item summary as it shows the final destination
      const lastOutboundFlight = outboundFlights[outboundFlights.length - 1]
      const destinationFromFlights = lastOutboundFlight?.destination || firstOutboundFlight.destination
      
      // Try to get destination from list-item summary (more reliable for final destination)
      const outboundSummary = listItem.find(".item").first().find(".stops p").last().find("span").last().text().trim()
      const destination = outboundSummary || destinationFromFlights

      // Create deal
      const dealData = {
        id: `${tripIdHash}_skyscanner_${providerName.replace(/\s+/g, "_")}`,
        trip: tripIdHash,
        origin,
        destination,
        departure_date: outboundDate,
        departure_time: firstOutboundFlight.departure_time,
        return_date: returnDateParsed,
        return_time: firstReturnFlight?.departure_time || null,
        source: "skyscanner",
        provider: providerName,
        price,
        link,
        created_at: nowIso,
        updated_at: nowIso,
      }

      // Validate and decode deal using schema
      const deal = yield* Schema.decodeUnknown(Deal)(dealData)
      deals.push(deal)
    }

    return {
      deals,
      flights,
      legs,
      trips,
    }
  })
