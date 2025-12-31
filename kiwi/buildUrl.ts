import { Effect } from "effect"
import { type SearchInput } from "../schemas"
import { KiwiConfig } from "./config"

/**
 * Converts a date from YYYY-MM-DD format to DD/MM/YYYY format
 */
const convertDateFormat = (date: string): string => {
  const [year, month, day] = date.split("-")
  return `${day}/${month}/${year}`
}

/**
 * Builds a search URL for Kiwi flights finder portal
 * 
 * @param searchInput - SearchInput object with origin, destination, departureDate, and optional returnDate
 * @returns Effect that resolves to URL string for the flights finder portal
 */
export const buildSearchUrl = (searchInput: SearchInput): Effect.Effect<string, never, KiwiConfig> =>
  Effect.gen(function* () {
    const config = yield* KiwiConfig
    const params = new URLSearchParams()
    
    params.set("currency", "EUR")
    params.set("type", searchInput.returnDate ? "return" : "oneway")
    params.set("cabinclass", "M")
    params.set("originplace", searchInput.origin)
    params.set("destinationplace", searchInput.destination)
    params.set("outbounddate", convertDateFormat(searchInput.departureDate))
    
    if (searchInput.returnDate) {
      params.set("inbounddate", convertDateFormat(searchInput.returnDate))
    }
    
    params.set("adults", "1")
    params.set("children", "0")
    params.set("infants", "0")
    params.set("bags-cabin", "0")
    params.set("bags-checked", "0")
    
    return `${config.baseUrl}/portal/kiwi?${params.toString()}`
  })
