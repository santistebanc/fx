/**
 * Run against fake server: Terminal 1: bun run serve   (or bun run index.ts)
 * Then: bun run demo
 *
 * Live site (respect robots / terms of use): bun run demo -- --real
 */
import { Effect, Console } from "effect"
import { searchWithFake as skyFake, searchWithReal as skyReal } from "../skyscanner/searchWithConfig"
import { searchWithFake as kiwiFake, searchWithReal as kiwiReal } from "../kiwi/searchWithConfig"
import { fakeServerOrigin, fakeServerPort } from "../utils"

const input = {
  origin: "BER",
  destination: "MAD",
  departureDate: "2026-07-15",
  returnDate: "2026-07-22",
} as const

const useReal = process.argv.includes("--real")

const summarize = (label: string, result: unknown) =>
  Effect.sync(() => {
    const r = result as { _tag: string; right?: unknown; left?: unknown }
    if (r._tag === "Right" && r.right && typeof r.right === "object") {
      const { data, metadata } = r.right as {
        data: { deals: unknown[] }
        metadata: Record<string, unknown>
      }
      console.log(`${label} OK — deals: ${data.deals.length}`, metadata)
    } else {
      console.log(
        `${label} failed:`,
        JSON.stringify(
          r,
          (key, val) => {
            if (key === "html" && typeof val === "string" && val.length > 500) {
              return `${val.slice(0, 500)}… (${val.length} chars)`
            }
            return val
          },
          2
        )
      )
    }
  })

const program = Effect.gen(function* () {
  if (!useReal) {
    const origin = fakeServerOrigin()
    yield* Console.log(
      `Using ${origin} (PORT=${String(fakeServerPort())}) — run \`bun run serve\` in another terminal.\n`
    )
  } else {
    yield* Console.log("Using https://www.flightsfinder.com")
    yield* Console.log(
      "Production note: Kiwi uses POST /portal/kiwi/search (not …/poll). Skyscanner uses POST /portal/sky/poll.\n"
    )
  }

  const sky = yield* (useReal ? skyReal(input) : skyFake(input)).pipe(Effect.either)
  const kiwi = yield* (useReal ? kiwiReal(input) : kiwiFake(input)).pipe(Effect.either)

  yield* summarize("Skyscanner", sky)
  yield* summarize("Kiwi", kiwi)
})

Effect.runPromise(program)
