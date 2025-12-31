import { Effect } from "effect"

/**
 * Type definition for the extracted poll data
 */
export interface PollData {
  finished: boolean
  count: number
  resultsHtml: string
}

/**
 * Extracts poll data from a pipe-delimited string.
 * The string format is: Y|500|...|resultsHtml|...
 * Note: Kiwi polls always return 'Y' (finished) as the first character.
 * 
 * @param pollString - The pipe-delimited string to parse
 * @returns An Effect that resolves to the extracted PollData object
 */
export const extractPollData = (pollString: string): Effect.Effect<PollData, Error> =>
  Effect.gen(function* () {
    const parts = pollString.split("|")

    if (parts.length < 7) {
      return yield* Effect.fail(
        new Error(`Expected at least 7 pipe-delimited parts, got ${parts.length}`)
      )
    }

    // First item: 'Y' -> boolean 'finished' (Kiwi always returns 'Y')
    const finishedStr = parts[0]?.trim()
    if (finishedStr !== "Y") {
      return yield* Effect.fail(
        new Error(`Expected first item to be 'Y' (Kiwi polls are always finished), got '${finishedStr}'`)
      )
    }
    const finished = true // Always true for Kiwi

    // Second item: number -> 'count'
    const countStr = parts[1]?.trim()
    if (!countStr) {
      return yield* Effect.fail(new Error("Second item (count) is missing or empty"))
    }
    const count = Number.parseInt(countStr, 10)
    if (Number.isNaN(count)) {
      return yield* Effect.fail(
        new Error(`Second item (count) is not a valid number: '${countStr}'`)
      )
    }

    // Seventh item (index 6): HTML string -> 'resultsHtml'
    const resultsHtml = parts[6]?.trim() ?? ""
    if (!resultsHtml) {
      return yield* Effect.fail(new Error("Seventh item (resultsHtml) is missing or empty"))
    }

    return {
      finished,
      count,
      resultsHtml,
    }
  })
