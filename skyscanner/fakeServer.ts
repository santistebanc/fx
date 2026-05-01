import { HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"
import { fixturePortalCookieHeaders, readSkyscannerFixtureInitialHtml, readSkyscannerFixturePollHtml } from "../fixturePortal"

export const initialHandler = Effect.gen(function* () {
  const html = readSkyscannerFixtureInitialHtml()
  return yield* HttpServerResponse.text(html, {
    headers: {
      "set-cookie": [...fixturePortalCookieHeaders],
      "content-type": "text/html; charset=utf-8",
    },
  })
})

export const pollHandler = Effect.gen(function* () {
  const html = readSkyscannerFixturePollHtml()
  return yield* HttpServerResponse.text(html, {
    headers: {
      "set-cookie": [...fixturePortalCookieHeaders],
      "content-type": "text/html; charset=utf-8",
    },
  })
})

