import { type SearchInput } from "../schemas"

/**
 * Builds a search URL for Skyscanner flights finder portal
 * 
 * @param searchInput - SearchInput object with origin, destination, departureDate, and optional returnDate
 * @returns URL string for the flights finder portal
 */
export const buildSearchUrl = (searchInput: SearchInput): string => {
  const params = new URLSearchParams()
  
  params.set("originplace", searchInput.origin)
  params.set("destinationplace", searchInput.destination)
  params.set("outbounddate", searchInput.departureDate)
  
  if (searchInput.returnDate) {
    params.set("inbounddate", searchInput.returnDate)
  }
  
  // Default values
  params.set("cabinclass", "Economy")
  params.set("adults", "1")
  params.set("children", "0")
  params.set("infants", "0")
  params.set("currency", "EUR")
  
  return `https://www.flightsfinder.com/portal/sky?${params.toString()}`
}
