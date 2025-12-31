import { Effect } from "effect"
import { type SearchInput } from "../schemas"
import { SkyscannerConfig } from "./config"

/**
 * Builds a search URL for Skyscanner flights finder portal
 * 
 * @param searchInput - SearchInput object with origin, destination, departureDate, and optional returnDate
 * @returns Effect that resolves to URL string for the flights finder portal
 */
export const buildSearchUrl = (searchInput: SearchInput): Effect.Effect<string, never, SkyscannerConfig> =>
  Effect.gen(function* () {
    const config = yield* SkyscannerConfig
    const params = new URLSearchParams()
    
    params.set("originplace", searchInput.origin)
    params.set("destinationplace", searchInput.destination)
    params.set("outbounddate", searchInput.departureDate)
    
    if (searchInput.returnDate) {
      params.set("inbounddate", searchInput.returnDate)
    }
    
    params.set("cabinclass", "Economy")
    params.set("adults", "1")
    params.set("children", "0")
    params.set("infants", "0")
    params.set("currency", "EUR")
    
    return `${config.baseUrl}/portal/sky?${params.toString()}`
  })
