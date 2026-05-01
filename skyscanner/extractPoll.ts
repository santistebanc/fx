import { Effect, Data } from "effect"
import { splitPortalPollHeaderAndHtml } from "../utils"

export class ReadResponseError extends Data.TaggedError("ReadResponseError")<{
  readonly cause: unknown
  readonly message: string
}> {}

export interface PollData {
  finished: boolean
  count: number
  resultsHtml: string
}

/**
 * Extracts poll data from a pipe-delimited string.
 * The string format is: `N|530|…|…|` on the first line, then HTML body.
 *
 * @param pollString - The pipe-delimited string to parse
 * @returns An Effect that resolves to the extracted PollData object
 */
export const extractPollData = (pollString: string): Effect.Effect<PollData, ReadResponseError> =>
  Effect.gen(function* () {
    const { headerLine, resultsHtml } = splitPortalPollHeaderAndHtml(pollString)
    if (!/^(?:Y|N)\|/.test(headerLine)) {
      const preview = headerLine.slice(0, 240).replace(/\s+/g, " ")
      const message = `Poll header missing Y| or N| prefix (blocked or HTML error?). Starts with: ${preview}`
      return yield* Effect.fail(
        new ReadResponseError({
          cause: message,
          message: `Failed to read response: ${message}`,
        })
      )
    }
    const parts = headerLine.split("|")

    if (parts.length < 3) {
      const message = `Expected at least 3 pipe-delimited header fields, got ${parts.length}`
      return yield* Effect.fail(
        new ReadResponseError({
          cause: message,
          message: `Failed to read response: ${message}`,
        })
      )
    }

    const finishedStr = parts[0]?.trim()
    if (finishedStr !== "N" && finishedStr !== "Y") {
      const message = `Expected first item to be 'N' or 'Y', got '${finishedStr}'`
      return yield* Effect.fail(
        new ReadResponseError({
          cause: message,
          message: `Failed to read response: ${message}`,
        })
      )
    }
    const finished = finishedStr === "Y"

    const countStr = parts[1]?.trim()
    if (!countStr) {
      const message = "Second item (count) is missing or empty"
      return yield* Effect.fail(
        new ReadResponseError({
          cause: message,
          message: `Failed to read response: ${message}`,
        })
      )
    }
    const count = Number.parseInt(countStr, 10)
    if (Number.isNaN(count)) {
      const message = `Second item (count) is not a valid number: '${countStr}'`
      return yield* Effect.fail(
        new ReadResponseError({
          cause: message,
          message: `Failed to read response: ${message}`,
        })
      )
    }

    // Live portal sometimes returns only the header row while still loading (`N|…`).
    if (finished && !resultsHtml.trim()) {
      const message = "HTML body after header line is missing or empty (expected when poll finished)"
      return yield* Effect.fail(
        new ReadResponseError({
          cause: message,
          message: `Failed to read response: ${message}`,
        })
      )
    }

    return {
      finished,
      count,
      resultsHtml,
    }
  })
