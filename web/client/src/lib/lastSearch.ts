const STORAGE_KEY = "flyscan.lastSearch.v1"

export type LastSearchSnapshot = {
  origin: string
  destination: string
  departureDate: string
  returnDate: string
  roundTrip: boolean
}

const isoRe = /^\d{4}-\d{2}-\d{2}$/
const iataRe = /^[A-Z]{3}$/

export function isIsoDate(d: string): boolean {
  return isoRe.test(d.trim())
}

function parseStored(raw: string | null): LastSearchSnapshot | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as unknown
    if (!data || typeof data !== "object") return null
    const r = data as Record<string, unknown>
    const origin = typeof r.origin === "string" ? r.origin.trim().toUpperCase() : ""
    const destination = typeof r.destination === "string" ? r.destination.trim().toUpperCase() : ""
    const departureDate = typeof r.departureDate === "string" ? r.departureDate.trim() : ""
    const returnDate = typeof r.returnDate === "string" ? r.returnDate.trim() : ""
    const roundTrip = r.roundTrip === true || r.roundTrip === false ? r.roundTrip : Boolean(returnDate)

    if (!iataRe.test(origin) || !iataRe.test(destination)) return null
    if (!isoRe.test(departureDate)) return null
    if (roundTrip) {
      if (!isoRe.test(returnDate)) return null
    }
    return { origin, destination, departureDate, returnDate: roundTrip ? returnDate : "", roundTrip }
  } catch {
    return null
  }
}

/** Empty dates until user picks or restores from `readLastSearch()`. */
export function defaultSearchDates(): Pick<LastSearchSnapshot, "departureDate" | "returnDate" | "roundTrip"> {
  return {
    departureDate: "",
    returnDate: "",
    roundTrip: true,
  }
}

export function readLastSearch(): LastSearchSnapshot | null {
  if (typeof localStorage === "undefined") return null
  return parseStored(localStorage.getItem(STORAGE_KEY))
}

/** Safe defaults merged with stored snapshot for React initial state. */
export function readInitialSearchChromeState(): {
  origin: string
  destination: string
  departureDate: string
  returnDate: string
  roundTrip: boolean
} {
  const s = readLastSearch()
  const d = defaultSearchDates()
  if (!s) return { origin: "", destination: "", ...d }
  return {
    origin: s.origin,
    destination: s.destination,
    departureDate: s.departureDate,
    returnDate: s.roundTrip ? s.returnDate : "",
    roundTrip: s.roundTrip,
  }
}

export function saveLastSearch(s: LastSearchSnapshot): void {
  if (typeof localStorage === "undefined") return
  const departureDate = s.departureDate.trim()
  const origin = s.origin.trim().toUpperCase()
  const destination = s.destination.trim().toUpperCase()
  if (!iataRe.test(origin) || !iataRe.test(destination)) return
  if (!isoRe.test(departureDate)) return
  const roundTrip = s.roundTrip
  let returnDate = s.returnDate.trim()
  if (roundTrip) {
    if (!isoRe.test(returnDate)) return
  } else {
    returnDate = ""
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ origin, destination, departureDate, returnDate, roundTrip }))
}
