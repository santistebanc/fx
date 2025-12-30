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
 * The string format is: N|530|...|resultsHtml|...
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

    // First item: 'N' or 'Y' -> boolean 'finished'
    const finishedStr = parts[0]?.trim()
    if (finishedStr !== "N" && finishedStr !== "Y") {
      return yield* Effect.fail(
        new Error(`Expected first item to be 'N' or 'Y', got '${finishedStr}'`)
      )
    }
    const finished = finishedStr === "Y"

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

