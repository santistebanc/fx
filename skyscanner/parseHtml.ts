import { Effect, DateTime, Schema, Data } from "effect"
import * as cheerio from "cheerio"
import { createHash } from "node:crypto"
import { euroDisplayTextToCents, listItemPriceCents } from "../utils"
import {
  inferArrivalDateIsoFromPortalClocks,
  inferNextLegDepartureDateIso,
  parsePortalHeadingDate,
  splitLocalIsoDateTime,
} from "../flightScrapeDates"
import { parseSkyscannerItineraryFromBookingHref } from "./itineraryBooking"
import { Deal, Flight, Leg, Trip } from "../schemas"

export class ParseHtmlError extends Data.TaggedError("ParseHtmlError")<{
  readonly cause: unknown
  readonly html: string
  readonly message: string
}> {}


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
): Effect.Effect<ParsedDealsData, ParseHtmlError> =>
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
      const row = listItem.closest(".list-item.row")
      const rowSummaryPriceText = listItem.find(".prices").text().trim()
      const rowFallbackPrice = listItemPriceCents(row.attr("data-price"), rowSummaryPriceText)
      const rowFallbackLink =
        listItem.find('a[href^="https://agw.skyscnr.com"]').first().attr("href")?.trim() || ""

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
          new ParseHtmlError({
            cause: `Could not parse outbound date from: ${outboundDateText}`,
            html: resultsHtml,
            message: `Failed to parse HTML: Could not parse outbound date from: ${outboundDateText}`,
          })
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
            new ParseHtmlError({
              cause: `Could not parse return date from: ${returnDateText}`,
              html: resultsHtml,
              message: `Failed to parse HTML: Could not parse return date from: ${returnDateText}`,
            })
          )
        }
      }

      const outboundFlights: Flight[] = []
      const outboundPanels =
        outboundPanel && outboundPanel.length > 0
          ? outboundPanel.find("._panel_body").toArray()
          : outboundSection.find("._panel_body").toArray()

      const returnPanels =
        returnSection.length > 0
          ? returnPanel && returnPanel.length > 0
            ? returnPanel.find("._panel_body").toArray()
            : returnSection.find("._panel_body").toArray()
          : []

      const bookingHref =
        $modal.find('._similar a[href*="itinerary"], ._similar a[href*="pageUrl"]').first().attr("href")?.trim() ||
        rowFallbackLink

      const itineraryFull = bookingHref ? parseSkyscannerItineraryFromBookingHref(bookingHref) : null
      let itineraryOutbound: NonNullable<typeof itineraryFull> | null = null
      let itineraryReturn: NonNullable<typeof itineraryFull> | null = null
      if (itineraryFull && itineraryFull.length === outboundPanels.length + returnPanels.length) {
        itineraryOutbound = itineraryFull.slice(0, outboundPanels.length)
        itineraryReturn = returnPanels.length > 0 ? itineraryFull.slice(outboundPanels.length) : []
      }

      let outboundPrevArrDate: string | null = null
      let outboundPrevArrTime: string | null = null

      for (let panelIndex = 0; panelIndex < outboundPanels.length; panelIndex++) {
        const panel = outboundPanels[panelIndex]!
        const $panel = $(panel)
        const flightNumberText = $panel.find("._head small").text().trim()
        // Skyscanner format: "KLM KL1770" - extract airline and flight number
        // Last word is the flight_number, rest is the airline
        const words = flightNumberText.split(/\s+/)
        if (words.length < 2) continue // Need at least airline + flight number

        const flightNumber = words[words.length - 1] || "" // Last word: "KL1770"
        const airline = words.slice(0, -1).join(" ") // All other words: "KLM"

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

        const itinLeg = itineraryOutbound?.[panelIndex]

        let departure_date = outboundDate
        let departure_time = departureTime
        let arrival_time = arrivalTime
        let duration = parseDuration(durationText)
        let arrival_date = outboundDate

        if (itinLeg) {
          const depIso = splitLocalIsoDateTime(itinLeg.departureIso)
          const arrIso = splitLocalIsoDateTime(itinLeg.arrivalIso)
          if (depIso && arrIso) {
            departure_date = depIso.date
            departure_time = depIso.time
            arrival_date = arrIso.date
            arrival_time = arrIso.time
            duration = itinLeg.durationMinutes
          }
        } else {
          if (panelIndex > 0 && outboundPrevArrDate && outboundPrevArrTime) {
            departure_date = inferNextLegDepartureDateIso({
              prevArrivalDate: outboundPrevArrDate,
              prevArrivalTime: outboundPrevArrTime,
              nextDepartureTime: departureTime,
            })
          }
          arrival_date = inferArrivalDateIsoFromPortalClocks({
            departure_date,
            departure_time: departureTime,
            arrival_time: arrivalTime,
          })
          const summaryArrival = parsePortalHeadingDate($panel.find("._summary span").first().text())
          if (summaryArrival) arrival_date = summaryArrival
        }

        outboundPrevArrDate = arrival_date
        outboundPrevArrTime = arrival_time

        const flightId = `${flightNumber.replace(/\s+/g, "_")}_${originAirport}_${departure_date}_${departure_time.replace(":", "-")}`

        const flightData = {
          id: flightId,
          flight_number: flightNumber,
          airline,
          origin: originAirport,
          destination: destAirport,
          departure_date,
          departure_time,
          arrival_date,
          arrival_time,
          duration,
          created_at: nowIso,
        }

        // Validate and decode flight using schema
        const flight = yield* Schema.decodeUnknown(Flight)(flightData).pipe(
          Effect.mapError(
            (error) =>
              new ParseHtmlError({
                cause: error,
                html: resultsHtml,
                message: `Failed to parse HTML: ${error instanceof Error ? error.message : String(error)}`,
              })
          )
        )
        flights.push(flight)
        outboundFlights.push(flight)
      }

      const returnFlights: Flight[] = []
      let returnPrevArrDate: string | null = null
      let returnPrevArrTime: string | null = null

      for (let panelIndex = 0; panelIndex < returnPanels.length; panelIndex++) {
        const panel = returnPanels[panelIndex]!
        const $panel = $(panel)
        const flightNumberText = $panel.find("._head small").text().trim()
        // Skyscanner format: "KLM KL1770" - extract airline and flight number
        // Last word is the flight_number, rest is the airline
        const words = flightNumberText.split(/\s+/)
        if (words.length < 2) continue // Need at least airline + flight number

        const flightNumber = words[words.length - 1] || "" // Last word: "KL1770"
        const airline = words.slice(0, -1).join(" ") // All other words: "KLM"

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

        const flightDateBase = returnDateParsed || outboundDate
        const itinLeg = itineraryReturn?.[panelIndex]

        let departure_date = flightDateBase
        let departure_time = departureTime
        let arrival_time = arrivalTime
        let duration = parseDuration(durationText)
        let arrival_date = flightDateBase

        if (itinLeg) {
          const depIso = splitLocalIsoDateTime(itinLeg.departureIso)
          const arrIso = splitLocalIsoDateTime(itinLeg.arrivalIso)
          if (depIso && arrIso) {
            departure_date = depIso.date
            departure_time = depIso.time
            arrival_date = arrIso.date
            arrival_time = arrIso.time
            duration = itinLeg.durationMinutes
          }
        } else {
          if (panelIndex > 0 && returnPrevArrDate && returnPrevArrTime) {
            departure_date = inferNextLegDepartureDateIso({
              prevArrivalDate: returnPrevArrDate,
              prevArrivalTime: returnPrevArrTime,
              nextDepartureTime: departureTime,
            })
          }
          arrival_date = inferArrivalDateIsoFromPortalClocks({
            departure_date,
            departure_time: departureTime,
            arrival_time: arrivalTime,
          })
          const summaryArrival = parsePortalHeadingDate($panel.find("._summary span").first().text())
          if (summaryArrival) arrival_date = summaryArrival
        }

        returnPrevArrDate = arrival_date
        returnPrevArrTime = arrival_time

        const flightId = `${flightNumber.replace(/\s+/g, "_")}_${originAirport}_${departure_date}_${departure_time.replace(":", "-")}`

        const flightData = {
          id: flightId,
          flight_number: flightNumber,
          airline,
          origin: originAirport,
          destination: destAirport,
          departure_date,
          departure_time,
          arrival_date,
          arrival_time,
          duration,
          created_at: nowIso,
        }

        // Validate and decode flight using schema
        const flight = yield* Schema.decodeUnknown(Flight)(flightData).pipe(
          Effect.mapError(
            (error) =>
              new ParseHtmlError({
                cause: error,
                html: resultsHtml,
                message: `Failed to parse HTML: ${error instanceof Error ? error.message : String(error)}`,
              })
          )
        )
        flights.push(flight)
        returnFlights.push(flight)
      }

      // Generate trip ID from sorted flight IDs
      const allFlightIds = [...outboundFlights, ...returnFlights].map((f) => f.id).sort()
      const tripIdHash = sha256(allFlightIds.join("|"))

      // Create trip
      const tripData = {
        id: tripIdHash,
        created_at: nowIso,
      }
      const trip = yield* Schema.decodeUnknown(Trip)(tripData).pipe(
        Effect.mapError(
          (error) =>
            new ParseHtmlError({
              cause: error,
              html: resultsHtml,
              message: `Failed to parse HTML: ${error instanceof Error ? error.message : String(error)}`,
            })
        )
      )
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
        const leg = yield* Schema.decodeUnknown(Leg)(legData).pipe(
          Effect.mapError(
            (error) =>
              new ParseHtmlError({
                cause: error,
                html: resultsHtml,
                message: `Failed to parse HTML: ${error instanceof Error ? error.message : String(error)}`,
              })
          )
        )
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
        const leg = yield* Schema.decodeUnknown(Leg)(legData).pipe(
          Effect.mapError(
            (error) =>
              new ParseHtmlError({
                cause: error,
                html: resultsHtml,
                message: `Failed to parse HTML: ${error instanceof Error ? error.message : String(error)}`,
              })
          )
        )
        legs.push(leg)
      }

      // Get first outbound flight for departure time and origin/destination
      const firstOutboundFlight = outboundFlights[0]
      const firstReturnFlight = returnFlights.length > 0 ? returnFlights[0] : null

      if (!firstOutboundFlight) {
        return yield* Effect.fail(
          new ParseHtmlError({
            cause: "No outbound flights found in modal",
            html: resultsHtml,
            message: "Failed to parse HTML: No outbound flights found in modal",
          })
        )
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

      const providerSection = $modal.find('p._heading:contains("Book Your Ticket")').parent()
      const bookingOfferDivs = providerSection.find("._similar > div").toArray()

      const offerSpecs: ReadonlyArray<{ offerIndex: number; providerName: string; price: number; link: string }> =
        bookingOfferDivs.length === 0
          ? [{ offerIndex: 0, providerName: "Unknown", price: rowFallbackPrice, link: rowFallbackLink }]
          : bookingOfferDivs.map((div, offerIndex) => {
              const $offer = $(div)
              const paras = $offer.children("p")
              const providerName = paras.first().text().trim() || "Unknown"
              const pricePara = paras.eq(1)
              const optionCents = euroDisplayTextToCents(pricePara.text())
              const price = optionCents > 0 ? optionCents : rowFallbackPrice
              const link =
                pricePara.find('a[href^="https://agw.skyscnr.com"]').attr("href")?.trim() || rowFallbackLink
              return { offerIndex, providerName, price, link }
            })

      for (const spec of offerSpecs) {
        const providerSlug = spec.providerName.replace(/\s+/g, "_")
        const dealData = {
          id: `${tripIdHash}_skyscanner_${providerSlug}_${spec.offerIndex}`,
          trip: tripIdHash,
          origin,
          destination,
          departure_date: outboundDate,
          departure_time: firstOutboundFlight.departure_time,
          return_date: returnDateParsed,
          return_time: firstReturnFlight?.departure_time || null,
          source: "skyscanner",
          provider: spec.providerName,
          price: spec.price,
          link: spec.link,
          created_at: nowIso,
          updated_at: nowIso,
        }

        const deal = yield* Schema.decodeUnknown(Deal)(dealData).pipe(
          Effect.mapError(
            (error) =>
              new ParseHtmlError({
                cause: error,
                html: resultsHtml,
                message: `Failed to parse HTML: ${error instanceof Error ? error.message : String(error)}`,
              })
          )
        )
        deals.push(deal)
      }
    }

    return {
      deals,
      flights,
      legs,
      trips,
    }
  })
