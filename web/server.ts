/**
 * Flight compare UI + JSON API.
 * Run: bun run web   (default http://localhost:3010)
 *
 * POST /api/search runs live FlightsFinder scrapes only.
 * GET /api/fixture-demo returns the frozen snapshot from `fixture.ts` (demo UI button).
 *
 * For offline portal HTML used by CLI (`bun run demo` without --real), run `bun run serve`
 * on PORT — this process no longer embeds `/portal/*` fixtures.
 */
import { existsSync, readFileSync } from "node:fs"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { Effect, ParseResult, Schema } from "effect"
import type { SearchInput, SearchResult } from "../schemas"
import { SearchInputSchema } from "../schemas"
import { fixture } from "../fixture"
import { searchWithReal as skyReal } from "../skyscanner/searchWithConfig"
import { searchWithReal as kiwiReal } from "../kiwi/searchWithConfig"

const dir = import.meta.dir

const apiLog = (msg: string, detail?: Record<string, unknown>) => {
  if (detail === undefined) console.log(`[fx api] ${msg}`)
  else console.log(`[fx api] ${msg}`, detail)
}

const distIndex = join(dir, "public", "dist", "index.html")

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

type SourceKey = "skyscanner" | "kiwi"

type ApiBody = {
  origin?: unknown
  destination?: unknown
  departureDate?: unknown
  returnDate?: unknown
  sources?: unknown
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
  apiLog(`→ ${source}`, { mode: "real" })

  const eff: Effect.Effect<SearchResult, unknown, never> =
    source === "skyscanner" ? skyReal(input) : kiwiReal(input)

  type SearchEither =
    | { readonly _tag: "Right"; readonly right: SearchResult }
    | { readonly _tag: "Left"; readonly left: unknown }
  const out = (await Effect.runPromise(eff.pipe(Effect.either))) as SearchEither
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

const parseBody = (raw: ApiBody): { ok: false; error: string } | { ok: true; input: SearchInput; sources: SourceKey[] } => {
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

  const srcRaw = raw.sources
  const sources: SourceKey[] = Array.isArray(srcRaw)
    ? srcRaw.filter((s): s is SourceKey => s === "skyscanner" || s === "kiwi")
    : ["skyscanner", "kiwi"]

  if (sources.length === 0) {
    return { ok: false, error: "Select at least one source (skyscanner or kiwi)" }
  }

  return { ok: true, input: decoded.right, sources }
}

const port = Number(process.env.WEB_PORT) || 3010

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === "GET" && url.pathname === "/") {
      try {
        await stat(distIndex)
        return htmlResponse(readFileSync(distIndex, "utf-8"), "text/html; charset=utf-8")
      } catch {
        return new Response(
          "React UI not built. Run: cd web/client && bun run build",
          { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
        )
      }
    }
    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      const name = url.pathname.replace(/^\//, "")
      const file = join(dir, "public", "dist", name)
      try {
        const st = await stat(file)
        if (!st.isFile()) return new Response("Not found", { status: 404 })
        const ext = name.split(".").pop() || ""
        const type =
          ext === "js"
            ? "application/javascript; charset=utf-8"
            : ext === "css"
              ? "text/css; charset=utf-8"
              : ext === "map"
                ? "application/json; charset=utf-8"
                : "application/octet-stream"
        return new Response(Bun.file(file), { headers: { "content-type": type, "cache-control": "no-store" } })
      } catch {
        return new Response("Not found", { status: 404 })
      }
    }
    if (req.method === "GET" && url.pathname === "/api/fixture-demo") {
      apiLog("GET /api/fixture-demo")
      return jsonResponse(fixture)
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

      const { input, sources } = parsed
      const reqT0 = Date.now()
      apiLog("POST /api/search", {
        mode: "real",
        sources,
        origin: input.origin,
        destination: input.destination,
        departureDate: input.departureDate,
        returnDate: input.returnDate ?? null,
      })

      const settled = await Promise.all(sources.map((s) => runSource(s, input)))

      const payload = {
        mode: "real" as const,
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
console.log(`API        POST http://localhost:${port}/api/search  (live)`)
console.log(`           GET  http://localhost:${port}/api/fixture-demo  (snapshot from fixture.ts)`)
if (!existsSync(distIndex)) {
  console.warn(`[fx web] React UI missing (${distIndex}). Build with: bun run web:build`)
}
