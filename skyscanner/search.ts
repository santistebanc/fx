import { Effect, Duration, DateTime, Data } from "effect"
import { HttpClient } from "@effect/platform"
import { NodeHttpClient } from "@effect/platform-node"
import { type SearchInput } from "../schemas"
import { buildSearchUrl } from "./buildUrl"
import { extractInitialData, type InitialData, ExtractInitialDataError } from "./extractInitial"
import { extractPollData, type PollData } from "./extractPoll"
import { parseDealsFromHtml, type ParsedDealsData, ParseHtmlError } from "./parseHtml"
import { makeInitialRequest, makePollRequest, InitialRequestError, PollRequestError } from "./requests"

export class PollMaxRetriesError extends Data.TaggedError("PollMaxRetriesError")<{
  readonly maxRetries: number
  readonly message: string
}> { }

export interface SearchResult {
  data: ParsedDealsData
  metadata: {
    numberOfDeals: number
    numberOfFlights: number
    numberOfLegs: number
    numberOfTrips: number
    pollRetries: number
    errors: string[]
    timeSpentMs: number
  }
}

const pollUntilFinished = (
  initialData: InitialData,
  cookies: string,
  searchUrl: string,
  maxRetries: number = 20
): Effect.Effect<
  { pollData: PollData; cookies: string; retries: number },
  PollRequestError | PollMaxRetriesError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    let currentCookies = cookies
    let retries = 0
    let pollData: PollData | null = null

    while (retries < maxRetries) {
      const result = yield* makePollRequest(initialData, currentCookies, searchUrl, retries + 1)
      pollData = result.pollData
      currentCookies = result.cookies

      if (pollData.finished) {
        return { pollData, cookies: currentCookies, retries }
      }

      yield* Effect.sleep(Duration.seconds(1))
      retries++
    }

    return yield* Effect.fail(
      new PollMaxRetriesError({
        maxRetries,
        message: `Max poll retries (${maxRetries}) reached without getting finished=true`,
      })
    )
  })

export const search = (
  searchInput: SearchInput
): Effect.Effect<
  SearchResult,
  InitialRequestError | ExtractInitialDataError | PollRequestError | PollMaxRetriesError | ParseHtmlError
> =>
  Effect.gen(function* () {
    const startTime = yield* DateTime.now
    const errors: string[] = []
    let pollRetries = 0

    const searchUrl = buildSearchUrl(searchInput)
    const initialRequestResult = yield* makeInitialRequest(searchUrl)
    const initialData = yield* extractInitialData(initialRequestResult.html)
    const pollResult = yield* pollUntilFinished(initialData, initialRequestResult.cookies, searchUrl)

    pollRetries = pollResult.retries

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
        pollRetries,
        errors,
        timeSpentMs,
      },
    }
  }).pipe(Effect.provide(NodeHttpClient.layer))
