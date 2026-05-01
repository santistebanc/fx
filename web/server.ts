/**
 * Flight compare UI + JSON API.
 * Run: bun run web   (default http://localhost:3010)
 *
 * Local fixtures: choosing “Local fixtures” in the UI uses HTML samples served from this same process
 * (no need for `bun run serve`). Standalone `bun run serve` is still available for CLI/tests on PORT.
 *
 * POST /api/search returns every deal from the scrape per selected source (no server-side row cap);
 * the UI merges legs/flights/trips into one ranked list. Pagination is UI-only.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, ParseResult, Schema } from "effect"
import type { SearchInput, SearchResult } from "../schemas"
import { SearchInputSchema } from "../schemas"
import {
  fixturePortalResponseHeaders,
  readKiwiFixtureInitialHtml,
  readKiwiFixturePollHtml,
  readSkyscannerFixtureInitialHtml,
  readSkyscannerFixturePollHtml,
} from "../fixturePortal"
import { searchWithFake as skyFake, searchWithReal as skyReal } from "../skyscanner/searchWithConfig"
import { searchWithFake as kiwiFake, searchWithReal as kiwiReal } from "../kiwi/searchWithConfig"

const dir = import.meta.dir

const apiLog = (msg: string, detail?: Record<string, unknown>) => {
  if (detail === undefined) console.log(`[fx api] ${msg}`)
  else console.log(`[fx api] ${msg}`, detail)
}

const loadPublic = (name: string) => readFileSync(join(dir, "public", name), "utf-8")

const htmlResponse = (body: string, type: string) =>
  new Response(body, {
    headers: {
      "content-type": type,
      "cache-control": "no-store",
    },
  })

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  })

/** Same portal paths as FlightsFinder; sample HTML only (fake UI mode). */
function tryFixturePortalResponse(req: Request, pathname: string): Response | null {
  if (req.method === "GET" && pathname === "/portal/sky") {
    return new Response(readSkyscannerFixtureInitialHtml(), { headers: fixturePortalResponseHeaders() })
  }
  if (req.method === "POST" && pathname === "/portal/sky/poll") {
    return new Response(readSkyscannerFixturePollHtml(), { headers: fixturePortalResponseHeaders() })
  }
  if (req.method === "GET" && pathname === "/portal/kiwi") {
    return new Response(readKiwiFixtureInitialHtml(), { headers: fixturePortalResponseHeaders() })
  }
  if (req.method === "POST" && (pathname === "/portal/kiwi/search" || pathname === "/portal/kiwi/poll")) {
    return new Response(readKiwiFixturePollHtml(), { headers: fixturePortalResponseHeaders() })
  }
  return null
}

type SourceKey = "skyscanner" | "kiwi"

type ApiBody = {
  origin?: unknown
  destination?: unknown
  departureDate?: unknown
  returnDate?: unknown
  sources?: unknown
  mode?: unknown
}

/** Trips / legs / flights referenced by all scraped deals for this source. */
const filterGraphForDeals = (
  full: SearchResult,
  deals: SearchResult["data"]["deals"]
): {
  trips: SearchResult["data"]["trips"]
  legs: SearchResult["data"]["legs"]
  flights: SearchResult["data"]["flights"]
} => {
  const tripIds = new Set(deals.map((d) => d.trip))
  const trips = full.data.trips.filter((t) => tripIds.has(t.id))
  const legs = full.data.legs.filter((l) => tripIds.has(l.trip))
  const flightIds = new Set(legs.map((l) => l.flight))
  const flights = full.data.flights.filter((f) => flightIds.has(f.id))
  return { trips, legs, flights }
}

const formatLeft = (left: unknown): string => {
  if (typeof left === "object" && left !== null && "message" in left && typeof (left as { message: string }).message === "string") {
    return (left as { message: string }).message
  }
  try {
    return JSON.stringify(left)
  } catch {
    return String(left)
  }
}

const runSource = async (
  mode: "fake" | "real",
  source: SourceKey,
  input: SearchInput
): Promise<
  | {
      ok: true
      source: SourceKey
      result: SearchResult
      trips: SearchResult["data"]["trips"]
      legs: SearchResult["data"]["legs"]
      flights: SearchResult["data"]["flights"]
    }
  | { ok: false; source: SourceKey; error: string }
> => {
  const t0 = Date.now()
  apiLog(`→ ${source}`, { mode })

  const eff =
    source === "skyscanner"
      ? mode === "fake"
        ? skyFake(input)
        : skyReal(input)
      : mode === "fake"
        ? kiwiFake(input)
        : kiwiReal(input)

  const out = await Effect.runPromise(eff.pipe(Effect.either))
  const elapsedMs = Date.now() - t0
  if (out._tag === "Right") {
    const full = out.right
    const graph = filterGraphForDeals(full, full.data.deals)
    apiLog(`← ${source} ok`, {
      elapsedMs,
      deals: full.data.deals.length,
      tripsInResponse: graph.trips.length,
      legsInResponse: graph.legs.length,
      flightsInResponse: graph.flights.length,
      parseTimeMs: full.metadata.timeSpentMs,
      pollRetries: full.metadata.pollRetries,
    })
    return { ok: true, source, result: full, ...graph }
  }
  apiLog(`← ${source} failed`, { elapsedMs, error: formatLeft(out.left) })
  return { ok: false, source, error: formatLeft(out.left) }
}

const parseBody = (raw: ApiBody): { ok: false; error: string } | { ok: true; input: SearchInput; sources: SourceKey[]; mode: "fake" | "real" } => {
  const decoded = Schema.decodeUnknownEither(SearchInputSchema)({
    origin: raw.origin,
    destination: raw.destination,
    departureDate: raw.departureDate,
    returnDate: raw.returnDate === "" || raw.returnDate === undefined || raw.returnDate === null ? undefined : raw.returnDate,
  })
  if (decoded._tag === "Left") {
    const msg = ParseResult.TreeFormatter.formatErrorSync(decoded.left)
    return { ok: false, error: msg }
  }

  const mode = raw.mode === "fake" ? "fake" : "real"
  const srcRaw = raw.sources
  const sources: SourceKey[] = Array.isArray(srcRaw)
    ? srcRaw.filter((s): s is SourceKey => s === "skyscanner" || s === "kiwi")
    : ["skyscanner", "kiwi"]

  if (sources.length === 0) {
    return { ok: false, error: "Select at least one source (skyscanner or kiwi)" }
  }

  return { ok: true, input: decoded.right, sources, mode }
}

const port = Number(process.env.WEB_PORT) || 3010
process.env.FIXTURE_HTTP_ORIGIN = `http://127.0.0.1:${port}`

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)

    const fixtureRes = tryFixturePortalResponse(req, url.pathname)
    if (fixtureRes) return fixtureRes

    if (req.method === "GET" && url.pathname === "/") {
      return htmlResponse(loadPublic("index.html"), "text/html; charset=utf-8")
    }
    if (req.method === "GET" && url.pathname === "/styles.css") {
      return htmlResponse(loadPublic("styles.css"), "text/css; charset=utf-8")
    }
    if (req.method === "GET" && url.pathname === "/app.js") {
      return htmlResponse(loadPublic("app.js"), "application/javascript; charset=utf-8")
    }

    if (req.method === "POST" && url.pathname === "/api/search") {
      let body: ApiBody
      try {
        body = (await req.json()) as ApiBody
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400)
      }

      const parsed = parseBody(body)
      if (!parsed.ok) {
        return jsonResponse({ error: parsed.error }, 400)
      }

      const { input, sources, mode } = parsed
      const reqT0 = Date.now()
      apiLog("POST /api/search", {
        mode,
        sources,
        origin: input.origin,
        destination: input.destination,
        departureDate: input.departureDate,
        returnDate: input.returnDate ?? null,
      })

      const settled = await Promise.all(sources.map((s) => runSource(mode, s, input)))

      const payload = {
        mode,
        input,
        sources: settled.map((r) =>
          r.ok
            ? {
                source: r.source,
                ok: true as const,
                metadata: r.result.metadata,
                deals: r.result.data.deals,
                trips: r.trips,
                legs: r.legs,
                flights: r.flights,
              }
            : { source: r.source, ok: false as const, error: r.error }
        ),
      }
      apiLog("response ready", {
        requestElapsedMs: Date.now() - reqT0,
        sources: settled.map((r) =>
          r.ok
            ? {
                source: r.source,
                ok: true,
                deals: r.result.data.deals.length,
              }
            : { source: r.source, ok: false, error: r.error }
        ),
      })
      return jsonResponse(payload)
    }

    return new Response("Not found", { status: 404 })
  },
})

console.log(`Flight UI  http://localhost:${port}`)
console.log(`API        POST http://localhost:${port}/api/search`)
console.log(`Fixtures   GET/POST http://127.0.0.1:${port}/portal/{sky,kiwi}/… (embedded; optional: bun run serve on PORT for CLI)`)
