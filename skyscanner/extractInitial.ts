import { DateTime, Effect, Data } from "effect"

export class ExtractInitialDataError extends Data.TaggedError("ExtractInitialDataError")<{
  readonly cause: unknown
  readonly html: string
  readonly message: string
}> {}

export type InitialData = {
  _token: string
  session: string
  suuid: string
  noc: string
  deeplink: string
  s: string
  adults: string
  children: string
  infants: string
  currency: string
}

/**
 * Extracts the Skyscanner data object from an HTML string.
 * Looks for a JavaScript object with a 'data:' property containing the specified fields.
 * 
 * @param htmlString - The HTML string to parse
 * @returns An Effect that resolves to the extracted SkyscannerData object
 */
export const extractInitialData = (htmlString: string) =>
  Effect.gen(function* () {
    const dataObjectRegex = /data:\s*\{[\s\S]*?'_token'[\s\S]*?\}/m

    const match = htmlString.match(dataObjectRegex)

    if (!match) {
      return yield* Effect.fail(
        new ExtractInitialDataError({
          cause: "Could not find data object in HTML string",
          html: htmlString,
          message: "Failed to extract initial data: Could not find data object in HTML string",
        })
      )
    }

    const dataObjectString = match[0]
    const extractField = fieldExtractor(dataObjectString)

    const _token = yield* extractField("_token")
    const session = yield* extractField("session")
    const suuid = yield* extractField("suuid")
    const now = yield* DateTime.now
    const noc = String(now.epochMillis)
    const deeplink = yield* extractField("deeplink")
    const s = yield* extractField("s")
    const adults = yield* extractField("adults")
    const children = yield* extractField("children")
    const infants = yield* extractField("infants")
    const currency = yield* extractField("currency")

    return {
      _token,
      session,
      suuid,
      noc,
      deeplink,
      s,
      adults,
      children,
      infants,
      currency,
    }
  })

const fieldExtractor = (dataObjectString: string) => (fieldName: string) =>
  Effect.gen(function* () {
    const regex = new RegExp(
      `'${fieldName}'\\s*:\\s*'((?:[^']|\\\\')*)'`,
      "s"
    )
    const fieldMatch = dataObjectString.match(regex)
    if (fieldMatch && fieldMatch[1]) {
      return yield* Effect.succeed(fieldMatch[1])
    }

    return yield* Effect.fail(
      new ExtractInitialDataError({
        cause: `Could not extract '${fieldName}' field`,
        html: dataObjectString,
        message: `Failed to extract initial data: Could not extract '${fieldName}' field`,
      })
    )
  })
