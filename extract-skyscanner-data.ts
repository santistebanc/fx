import { DateTime, Effect } from "effect"

/**
 * Extracts the Skyscanner data object from an HTML string.
 * Looks for a JavaScript object with a 'data:' property containing the specified fields.
 * 
 * @param htmlString - The HTML string to parse
 * @returns An Effect that resolves to the extracted SkyscannerData object
 */
export const extractSkyscannerData = (htmlString: string) =>
  Effect.gen(function* () {
    // Find the data object in the JavaScript code
    // Look for the pattern: data: { ... } that contains '_token'
    // Use a more flexible regex that handles multi-line content
    const dataObjectRegex = /data:\s*\{[\s\S]*?'_token'[\s\S]*?\}/m

    const match = htmlString.match(dataObjectRegex)

    if (!match) {
      return yield* Effect.fail(
        new Error("Could not find data object in HTML string")
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

// Extract individual fields using regex
const fieldExtractor = (dataObjectString: string) => (fieldName: string) =>
  Effect.gen(function* () {
    // Match: 'fieldName': 'value'
    // The value can contain escaped quotes, so we match until we find a non-escaped closing quote
    const regex = new RegExp(
      `'${fieldName}'\\s*:\\s*'((?:[^']|\\\\')*)'`,
      "s"
    )
    const fieldMatch = dataObjectString.match(regex)
    if (fieldMatch && fieldMatch[1]) {
      return yield* Effect.succeed(fieldMatch[1])
    }

    return yield* Effect.fail(new Error(`Could not extract '${fieldName}' field`))
  })