import { HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"
import { fixturePortalCookieHeaders, readKiwiFixtureInitialHtml, readKiwiFixturePollHtml } from "../fixturePortal"

export const initialHandler = Effect.gen(function* () {
  const html = readKiwiFixtureInitialHtml()
  return yield* HttpServerResponse.text(html, {
    headers: {
      "set-cookie": [...fixturePortalCookieHeaders],
      "content-type": "text/html; charset=utf-8",
    },
  })
})

export const pollHandler = Effect.gen(function* () {
  const html = readKiwiFixturePollHtml()
  return yield* HttpServerResponse.text(html, {
    headers: {
      "set-cookie": [...fixturePortalCookieHeaders],
      "content-type": "text/html; charset=utf-8",
    },
  })
})

