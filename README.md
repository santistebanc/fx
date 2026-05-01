# fx

Scrape flight search results from **Skyscanner** and **Kiwi.com** flows exposed through **FlightsFinder-style** portal HTML (initial page plus poll/search responses). The pipeline uses **[Effect](https://effect.website/)**, **[Bun](https://bun.sh/)**, and **cheerio** to parse trips, legs, flights, and priced booking options into shared schemas (`schemas.ts`).

## Requirements

- [Bun](https://bun.sh/) (see `package.json` for typical versions).

```bash
bun install
```

## Scripts

| Command | Purpose |
| --- | --- |
| `bun test` | Unit tests (parsers, utils, graph dedupe). |
| `bun run verify-fixtures` | Checks bundled poll HTML vs parsers (Skyscanner: booking rows + prices; Kiwi: row prices). Can take ~1–2 minutes on large Skyscanner samples. |
| `bun run demo` | Runs Skyscanner + Kiwi searches (`--real` hits production; default uses fake portal origin — see below). |
| `bun run web` | Flight comparison **UI** + `POST /api/search` on **`WEB_PORT`** (default **3010**). Embeds static `/portal/*` fixtures on the same origin so scrapers do not need a separate fake server. |
| `bun run serve` | Standalone Effect HTTP server serving sample portal routes only (`PORT`, default **3000**). Useful for CLI/tests without the web app. |

## Web UI

- Open the URL logged by `bun run web` (e.g. `http://127.0.0.1:3010`).
- Optional **Sources**: Skyscanner and/or Kiwi (checkboxes).
- **Live** uses real FlightsFinder endpoints; **Local fixtures** uses HTML shipped in `skyscanner/samples/` and `kiwi/samples/` (served from the web process).
- Successful responses are **merged in the browser** into a **single list**: trips ordered by **lowest best fare**, with all booking chips for that itinerary grouped on one card (including offers from both feeds when trip ids align). Failed feeds show as compact error strips above the combined results.

## Scraping behavior (summary)

- **Skyscanner**: GET initial HTML → poll until finished → parse poll HTML. Multiple **Book Your Ticket / `._similar`** rows per itinerary produce **multiple deals** sharing one trip.
- **Kiwi**: GET initial → POST search/poll → parse.
- After parse, **`dedupeParsedDealsData`** collapses duplicate **ids** in flights, trips, legs, and deals (first wins) before returning `SearchResult` metadata counts.

## Environment variables

| Variable | Used by | Notes |
| --- | --- | --- |
| `WEB_PORT` | `web/server.ts` | HTTP port for UI + API + embedded fixtures (default `3010`). Sets `FIXTURE_HTTP_ORIGIN` for scrapers running against this process. |
| `PORT` | `bun run serve`, `utils.fakeServerPort` | Standalone fake portal port (default `3000`). |
| `FIXTURE_HTTP_ORIGIN` | `utils.fakeServerOrigin` | When set (e.g. by `web/server.ts`), scrapers in fake mode target this origin instead of `127.0.0.1:$PORT`. |
| `FX_POLL_MAX_RETRIES` | `skyscanner/search.ts` | Max Skyscanner poll attempts (default `180`, 1s apart). |

## Layout

- `skyscanner/`, `kiwi/` — config, HTTP requests, HTML extractors, `parseHtml`, `search.ts`, fake handlers.
- `web/public/` — static UI (`app.js`, `index.html`, `styles.css`).
- `fixturePortal.ts` — reads sample HTML and portal cookie headers for tests and servers.
- `scripts/demo.ts`, `scripts/verifyFixtures.ts` — CLI helpers.

## Legal / etiquette

Respect FlightsFinder and airline partners’ **terms of use** and **robots** guidance. Prefer **local fixtures** for development and CI; use **live** mode sparingly and responsibly.
