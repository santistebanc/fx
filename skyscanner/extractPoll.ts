import { Effect, Data } from "effect"

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
 * The string format is: N|530|...|resultsHtml|...
 * 
 * @param pollString - The pipe-delimited string to parse
 * @returns An Effect that resolves to the extracted PollData object
 */
export const extractPollData = (pollString: string): Effect.Effect<PollData, ReadResponseError> =>
  Effect.gen(function* () {
    const parts = pollString.split("|")

    if (parts.length < 7) {
      const message = `Expected at least 7 pipe-delimited parts, got ${parts.length}`
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

    const resultsHtml = parts[6]?.trim() ?? ""
    if (!resultsHtml) {
      const message = "Seventh item (resultsHtml) is missing or empty"
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
