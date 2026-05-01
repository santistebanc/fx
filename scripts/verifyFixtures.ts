/**
 * Ensures bundled portal poll fixtures stay aligned with the HTML parsers:
 * - Poll header count vs modals
 * - Skyscanner: deal count = sum of `._similar` booking rows per modal (or 1 fallback); each price matches offer text or row fallback
 * - Kiwi: deal count = modals; each deal price matches row markup
 *
 * Run: bun run verify-fixtures
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import * as cheerio from "cheerio"
import { extractPollData } from "../skyscanner/extractPoll"
import { parseDealsFromHtml as parseSkyDeals } from "../skyscanner/parseHtml"
import { parseDealsFromHtml as parseKiwiDeals } from "../kiwi/parseHtml"
import { euroDisplayTextToCents, listItemPriceCents } from "../utils"

const root = join(import.meta.dir, "..")

async function verifySkyscannerPoll(label: string, pollPath: string) {
  const raw = readFileSync(join(root, pollPath), "utf-8")
  const poll = await Effect.runPromise(extractPollData(raw))
  const parsed = await Effect.runPromise(parseSkyDeals(poll.resultsHtml))
  const $ = cheerio.load(poll.resultsHtml)
  const modalEls = $("div.modal[id^=\"myModal\"]").toArray()

  if (poll.count !== modalEls.length) {
    throw new Error(`${label}: poll header count ${poll.count} !== modal nodes ${modalEls.length}`)
  }

  let expectedDealCount = 0
  for (const el of modalEls) {
    const n = $(el)
      .find("p._heading:contains(\"Book Your Ticket\")")
      .parent()
      .find("._similar > div").length
    expectedDealCount += n === 0 ? 1 : n
  }

  if (parsed.deals.length !== expectedDealCount) {
    throw new Error(
      `${label}: parsed deals ${parsed.deals.length} !== expected ${expectedDealCount} (booking rows per modal)`
    )
  }

  let cursor = 0
  let priceMismatches = 0
  let firstBad: { modalId: string; offerIndex: number; expected: number; actual: number | undefined } | undefined

  for (const el of modalEls) {
    const $modal = $(el)
    const modalId = $modal.attr("id") || ""
    const listItem = $(`.list-item a[onclick*=\"${modalId}\"]`).closest(".list-item")
    const row = listItem.closest(".list-item.row")
    const rowFallback = listItemPriceCents(row.attr("data-price"), listItem.find(".prices").text().trim())

    const offers = $modal
      .find("p._heading:contains(\"Book Your Ticket\")")
      .parent()
      .find("._similar > div")
      .toArray()

    const offerSlots = offers.length === 0 ? 1 : offers.length

    for (let j = 0; j < offerSlots; j++) {
      const expected =
        offers.length === 0
          ? rowFallback
          : (() => {
              const opt = euroDisplayTextToCents($(offers[j]!).children("p").eq(1).text())
              return opt > 0 ? opt : rowFallback
            })()

      const actual = parsed.deals[cursor]?.price
      if (expected !== actual) {
        priceMismatches++
        firstBad ??= { modalId, offerIndex: j, expected, actual }
      }
      cursor++
    }
  }

  if (priceMismatches > 0) {
    throw new Error(
      `${label}: ${priceMismatches} deal prices disagree with markup (first: ${JSON.stringify(firstBad)})`
    )
  }

  console.log(
    `${label} OK — ${parsed.deals.length} deals (${modalEls.length} itineraries), prices match, ${parsed.flights.length} flights, ${parsed.legs.length} legs`
  )
}

async function verifyKiwiPoll(label: string, pollPath: string) {
  const raw = readFileSync(join(root, pollPath), "utf-8")
  const poll = await Effect.runPromise(extractPollData(raw))
  const parsed = await Effect.runPromise(parseKiwiDeals(poll.resultsHtml))
  const $ = cheerio.load(poll.resultsHtml)
  const modalIds = $("div.modal[id^=\"myModal\"]")
    .toArray()
    .map((el) => $(el).attr("id"))
    .filter((id): id is string => Boolean(id))

  if (poll.count !== modalIds.length) {
    throw new Error(`${label}: poll header count ${poll.count} !== modal nodes ${modalIds.length}`)
  }
  if (parsed.deals.length !== modalIds.length) {
    throw new Error(`${label}: parsed deals ${parsed.deals.length} !== modals ${modalIds.length}`)
  }

  let priceMismatches = 0
  let firstBad: { modalId: string; expected: number; actual: number | undefined } | undefined

  for (let i = 0; i < modalIds.length; i++) {
    const modalId = modalIds[i]!
    const listItem = $(`.list-item a[onclick*=\"${modalId}\"]`).closest(".list-item")
    const row = listItem.closest(".list-item.row")
    const priceText = listItem.find(".prices").text().trim()
    const expected = listItemPriceCents(row.attr("data-price"), priceText)
    const actual = parsed.deals[i]?.price
    if (expected !== actual) {
      priceMismatches++
      firstBad ??= { modalId, expected, actual }
    }
  }

  if (priceMismatches > 0) {
    throw new Error(
      `${label}: ${priceMismatches} deal prices disagree with row markup (first: ${JSON.stringify(firstBad)})`
    )
  }

  console.log(
    `${label} OK — ${parsed.deals.length} deals, prices match rows, ${parsed.flights.length} flights, ${parsed.legs.length} legs`
  )
}

async function main() {
  await verifySkyscannerPoll("Skyscanner poll-1", "skyscanner/samples/poll-1.html")
  await verifyKiwiPoll("Kiwi poll", "kiwi/samples/poll.html")
  console.log("All fixture polls consistent with parsers.")
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
