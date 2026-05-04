import { Effect, Duration, DateTime, Data, Either } from "effect"
import { HttpClient } from "@effect/platform"
import { dedupeParsedDealsData, type SearchInput, type SearchResult } from "../schemas"
import { buildSearchUrl } from "./buildUrl"
import { extractInitialData, type InitialData, ExtractInitialDataError } from "./extractInitial"
import { type PollData } from "./extractPoll"
import { parseDealsFromHtml, ParseHtmlError } from "./parseHtml"
import { makeInitialRequest, makePollRequest, InitialRequestError, PollRequestError } from "./requests"
import { SkyscannerConfig } from "./config"

export class PollMaxRetriesError extends Data.TaggedError("PollMaxRetriesError")<{
  readonly maxRetries: number
  readonly message: string
}> { }

const log = (phase: string, detail?: Record<string, unknown>) => {
  if (detail === undefined) console.log(`[fx scrape skyscanner] ${phase}`)
  else console.log(`[fx scrape skyscanner] ${phase}`, detail)
}

/** Poll until portal reports finished; override with FX_POLL_MAX_RETRIES (default 5 attempts, 1s apart). */
const defaultPollMaxRetries = (): number => {
  const n = Number(process.env.FX_POLL_MAX_RETRIES)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5
}

const pollUntilFinished = (
  initialData: InitialData,
  cookies: string,
  searchUrl: string,
  maxRetries: number = defaultPollMaxRetries()
): Effect.Effect<
  { pollData: PollData; cookies: string; retries: number },
  PollRequestError | PollMaxRetriesError,
  HttpClient.HttpClient | SkyscannerConfig
> =>
  Effect.gen(function* () {
    let currentCookies = cookies
    let retries = 0
    let lastGood: { pollData: PollData; cookies: string } | null = null

    while (retries < maxRetries) {
      const attempt = retries + 1
      log(`poll attempt ${attempt}/${maxRetries}`)
      const outcome = yield* Effect.either(
        makePollRequest(initialData, currentCookies, searchUrl, attempt)
      )

      if (Either.isRight(outcome)) {
        const result = outcome.right
        lastGood = { pollData: result.pollData, cookies: result.cookies }
        currentCookies = result.cookies
        const { pollData } = result

        log(`poll ${attempt} response`, {
          finished: pollData.finished,
          resultsHtmlChars: pollData.resultsHtml?.length ?? 0,
        })

        if (pollData.finished) {
          log(`poll finished after ${attempt} attempt(s)`)
          return { pollData, cookies: currentCookies, retries }
        }

        yield* Effect.sleep(Duration.seconds(1))
        retries++
        continue
      }

      const err = outcome.left
      if (lastGood !== null) {
        log(
          `poll attempt ${attempt} failed; using last successful poll (finished=${lastGood.pollData.finished})`,
          { message: err.message }
        )
        return {
          pollData: lastGood.pollData,
          cookies: lastGood.cookies,
          retries,
        }
      }

      return yield* Effect.fail(err)
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
  InitialRequestError | ExtractInitialDataError | PollRequestError | PollMaxRetriesError | ParseHtmlError,
  HttpClient.HttpClient | SkyscannerConfig
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

    const pollResult = yield* pollUntilFinished(initialData, initialRequestResult.cookies, searchUrl)

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
        pollRetries: pollResult.retries,
        errors: [],
        timeSpentMs,
      },
    }
  })
