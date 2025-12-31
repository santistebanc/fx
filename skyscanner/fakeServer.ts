import { HttpRouter, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const readSampleFile = (path: string): string => {
  return readFileSync(join(__dirname, path), "utf-8")
}

const fakeCookies = [
  "CookieScriptConsent={\"action\":\"accept\"}; Path=/",
  "flightsfinder_session=fake_session_token_12345; Path=/",
]

export const initialHandler = Effect.gen(function* () {
  const html = readSampleFile("skyscanner/samples/initial.html")
  return yield* HttpServerResponse.text(html, {
    headers: {
      "set-cookie": fakeCookies,
      "content-type": "text/html; charset=utf-8",
    },
  })
})

export const pollHandler = Effect.gen(function* () {
  const html = readSampleFile("skyscanner/samples/poll-1.html")
  return yield* HttpServerResponse.text(html, {
    headers: {
      "set-cookie": fakeCookies,
      "content-type": "text/html; charset=utf-8",
    },
  })
})

