import { Effect, Data } from "effect"
import { HttpClient, HttpClientRequest } from "@effect/platform"
import { extractCookies, mergeCookies } from "../utils"
import { extractPollData, type PollData } from "./extractPoll"
import { type InitialData } from "./extractInitial"

export class InitialRequestError extends Data.TaggedError("InitialRequestError")<{
  readonly cause: unknown
  readonly url: string
  readonly message: string
}> {}

export class PollRequestError extends Data.TaggedError("PollRequestError")<{
  readonly cause: unknown
  readonly url: string
  readonly attempt: number
  readonly message: string
}> {}

export const makeInitialRequest = (
  searchUrl: string
): Effect.Effect<
  { html: string; cookies: string },
  InitialRequestError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient

    const getRequest = HttpClientRequest.get(searchUrl, {
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "en,de;q=0.9",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      },
    })

    const getResponse = yield* client.execute(getRequest)
    const html = yield* getResponse.text
    const cookies = extractCookies(getResponse)

    return { html, cookies }
  }).pipe(
    Effect.catchAll((error) =>
      Effect.fail(
        new InitialRequestError({
          cause: error,
          url: searchUrl,
          message: `Initial request failed for ${searchUrl}: ${error instanceof Error ? error.message : String(error)}`,
        })
      )
    )
  )

export const makePollRequest = (
  initialData: InitialData,
  cookies: string,
  searchUrl: string,
  attempt: number = 1
): Effect.Effect<
  { pollData: PollData; cookies: string },
  PollRequestError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient

    const formParams = new URLSearchParams(initialData)

    const pollUrl = "https://www.flightsfinder.com/portal/sky/poll"
    const request = HttpClientRequest.post(pollUrl, {
      headers: {
        "accept": "*/*",
        "accept-language": "en,de;q=0.9",
        "cache-control": "no-cache",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "cookie": cookies,
        "dnt": "1",
        "origin": "https://www.flightsfinder.com",
        "pragma": "no-cache",
        "referer": searchUrl,
        "sec-ch-ua": '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        "x-requested-with": "XMLHttpRequest",
      },
    }).pipe(HttpClientRequest.setUrlParams(formParams))

    const response = yield* client.execute(request)
    const responseText = yield* response.text
    const newCookies = extractCookies(response)
    const updatedCookies = mergeCookies(cookies, newCookies)
    const pollData = yield* extractPollData(responseText)

    return { pollData, cookies: updatedCookies }
  }).pipe(
    Effect.catchAll((error: unknown) => {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
            ? (error as { message: string }).message
            : String(error)
      return Effect.fail(
        new PollRequestError({
          cause: error,
          url: "https://www.flightsfinder.com/portal/sky/poll",
          attempt,
          message: `Poll request failed (attempt ${attempt}): ${errorMessage}`,
        })
      )
    })
  )
