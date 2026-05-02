/**
 * Static fixtures for Skyscanner / Kiwi portal HTML flows (`web/server.ts`, `bun run serve`).
 * Poll consistency: `bun run verify-fixtures`.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const pkgRoot = import.meta.dir

/** Same cookies as the standalone fake Effect servers — scraped pipeline merges these. */
export const fixturePortalCookieHeaders: readonly string[] = [
  'CookieScriptConsent={"action":"accept"}; Path=/',
  "flightsfinder_session=fake_session_token_12345; Path=/",
]

export const readSkyscannerFixtureInitialHtml = (): string =>
  readFileSync(join(pkgRoot, "skyscanner", "samples", "initial.html"), "utf-8")

export const readSkyscannerFixturePollHtml = (): string =>
  readFileSync(join(pkgRoot, "skyscanner", "samples", "poll-1.html"), "utf-8")

export const readKiwiFixtureInitialHtml = (): string =>
  readFileSync(join(pkgRoot, "kiwi", "samples", "initial.html"), "utf-8")

export const readKiwiFixturePollHtml = (): string =>
  readFileSync(join(pkgRoot, "kiwi", "samples", "poll.html"), "utf-8")

/** Bun / Fetch response headers mirroring the fake Effect handlers. */
export function fixturePortalResponseHeaders(): Headers {
  const headers = new Headers()
  headers.set("content-type", "text/html; charset=utf-8")
  for (const c of fixturePortalCookieHeaders) {
    headers.append("set-cookie", c)
  }
  return headers
}
