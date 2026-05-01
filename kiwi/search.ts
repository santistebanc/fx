import { Effect, DateTime, Data } from "effect"
import { HttpClient } from "@effect/platform"
import { dedupeParsedDealsData, type SearchInput, type SearchResult } from "../schemas"
import { buildSearchUrl } from "./buildUrl"
import { extractInitialData, type InitialData, ExtractInitialDataError } from "./extractInitial"
import { parseDealsFromHtml, ParseHtmlError } from "./parseHtml"
import { makeInitialRequest, makePollRequest, InitialRequestError, PollRequestError } from "./requests"
import { KiwiConfig } from "./config"

export class PollMaxRetriesError extends Data.TaggedError("PollMaxRetriesError")<{
  readonly maxRetries: number
  readonly message: string
}> { }

const log = (phase: string, detail?: Record<string, unknown>) => {
  if (detail === undefined) console.log(`[fx scrape kiwi] ${phase}`)
  else console.log(`[fx scrape kiwi] ${phase}`, detail)
}

export const search = (
  searchInput: SearchInput
): Effect.Effect<
  SearchResult,
  InitialRequestError | ExtractInitialDataError | PollRequestError | PollMaxRetriesError | ParseHtmlError,
  HttpClient.HttpClient | KiwiConfig
> =>
  Effect.gen(function* () {
    const startTime = yield* DateTime.now

    log("start", {
      origin: searchInput.origin,
      destination: searchInput.destination,
      departureDate: searchInput.departureDate,
      returnDate: searchInput.returnDate ?? null,
    })

    const searchUrl = yield* buildSearchUrl(searchInput)
    log("GET initial HTML", { url: searchUrl })

    const initialRequestResult = yield* makeInitialRequest(searchUrl)
    log("initial response", { htmlChars: initialRequestResult.html.length })

    const initialData = yield* extractInitialData(initialRequestResult.html)
    log("extracted portal session data")

    log("POST search / poll (single request)")
    const pollResult = yield* makePollRequest(initialData, initialRequestResult.cookies, searchUrl, 1)
    log("poll response", {
      finished: pollResult.pollData.finished,
      resultsHtmlChars: pollResult.pollData.resultsHtml.length,
    })

    log("parsing results HTML")
    const parsedRaw = yield* parseDealsFromHtml(pollResult.pollData.resultsHtml)
    const parsedData = dedupeParsedDealsData(parsedRaw)

    const endTime = yield* DateTime.now
    const timeSpentMs = endTime.epochMillis - startTime.epochMillis

    const dedupeDropped = {
      deals: parsedRaw.deals.length - parsedData.deals.length,
      trips: parsedRaw.trips.length - parsedData.trips.length,
      legs: parsedRaw.legs.length - parsedData.legs.length,
      flights: parsedRaw.flights.length - parsedData.flights.length,
    }
    log("parse complete", {
      deals: parsedData.deals.length,
      trips: parsedData.trips.length,
      legs: parsedData.legs.length,
      flights: parsedData.flights.length,
      ...(dedupeDropped.deals || dedupeDropped.trips || dedupeDropped.legs || dedupeDropped.flights
        ? { dedupeDropped }
        : {}),
      timeSpentMs,
    })

    return {
      data: parsedData,
      metadata: {
        numberOfDeals: parsedData.deals.length,
        numberOfFlights: parsedData.flights.length,
        numberOfLegs: parsedData.legs.length,
        numberOfTrips: parsedData.trips.length,
        pollRetries: 0,
        errors: [],
        timeSpentMs,
      },
    }
  })
