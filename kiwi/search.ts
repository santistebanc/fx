import { Effect, DateTime, Data } from "effect"
import { HttpClient } from "@effect/platform"
import { type SearchInput, type SearchResult } from "../schemas"
import { buildSearchUrl } from "./buildUrl"
import { extractInitialData, type InitialData, ExtractInitialDataError } from "./extractInitial"
import { parseDealsFromHtml, ParseHtmlError } from "./parseHtml"
import { makeInitialRequest, makePollRequest, InitialRequestError, PollRequestError } from "./requests"
import { KiwiConfig } from "./config"

export class PollMaxRetriesError extends Data.TaggedError("PollMaxRetriesError")<{
  readonly maxRetries: number
  readonly message: string
}> { }

export const search = (
  searchInput: SearchInput
): Effect.Effect<
  SearchResult,
  InitialRequestError | ExtractInitialDataError | PollRequestError | PollMaxRetriesError | ParseHtmlError,
  HttpClient.HttpClient | KiwiConfig
> =>
  Effect.gen(function* () {
    const startTime = yield* DateTime.now

    const searchUrl = yield* buildSearchUrl(searchInput)
    const initialRequestResult = yield* makeInitialRequest(searchUrl)
    const initialData = yield* extractInitialData(initialRequestResult.html)
    
    const pollResult = yield* makePollRequest(initialData, initialRequestResult.cookies, searchUrl, 1)

    const parsedData = yield* parseDealsFromHtml(pollResult.pollData.resultsHtml)

    const endTime = yield* DateTime.now
    const timeSpentMs = endTime.epochMillis - startTime.epochMillis

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
