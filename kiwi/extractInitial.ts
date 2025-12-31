import { DateTime, Effect } from "effect"

/**
 * Extracts the Kiwi data object from an HTML string.
 * Looks for a JavaScript object with a 'data:' property containing the specified fields.
 * 
 * @param htmlString - The HTML string to parse
 * @returns An Effect that resolves to the extracted KiwiData object
 */
export const extractInitialData = (htmlString: string) =>
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
    const originplace = yield* extractField("originplace")
    const destinationplace = yield* extractField("destinationplace")
    const outbounddate = yield* extractField("outbounddate")
    const inbounddate = yield* extractField("inbounddate")
    const cabinclass = yield* extractField("cabinclass")
    const adults = yield* extractField("adults")
    const children = yield* extractField("children")
    const infants = yield* extractField("infants")
    const currency = yield* extractField("currency")
    const type = yield* extractField("type")
    const bagsCabin = yield* extractField("bags-cabin")
    const bagsChecked = yield* extractField("bags-checked")
    const now = yield* DateTime.now
    const noc = String(now.epochMillis)

    return {
      _token,
      originplace,
      destinationplace,
      outbounddate,
      inbounddate,
      cabinclass,
      adults,
      children,
      infants,
      currency,
      type,
      "bags-cabin": bagsCabin,
      "bags-checked": bagsChecked,
      noc,
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
