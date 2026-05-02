/**
 * Skyscanner "Select" links nest a `pageUrl` chain that eventually contains
 * `itinerary=flight|…` with full local departure/arrival timestamps per segment.
 */

export type SkyscannerItineraryLeg = {
  readonly departureIso: string
  readonly arrivalIso: string
  readonly durationMinutes: number
  readonly flightNumber: string
}

const normalizeMinuteIso = (raw: string | undefined): string | null => {
  if (!raw) return null
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const date = m[1]!
  const hh = m[2]!.padStart(2, "0")
  const mm = m[3]!
  return `${date}T${hh}:${mm}`
}

const parseFlightChunk = (chunk: string): SkyscannerItineraryLeg | null => {
  if (!chunk.startsWith("flight|")) return null
  const parts = chunk.split("|")
  if (parts.length < 8) return null
  const departureIso = normalizeMinuteIso(parts[4])
  const arrivalIso = normalizeMinuteIso(parts[6])
  const durationMinutes = Number(parts[7])
  const flightNumber = parts[2] ?? ""
  if (!departureIso || !arrivalIso || !Number.isFinite(durationMinutes)) return null
  return { departureIso, arrivalIso, durationMinutes, flightNumber }
}

/** Follow redirect / nested `pageUrl` / `u` until `itinerary=` appears; return decoded param value. */
const extractItineraryParamValue = (href: string): string | null => {
  let blob = href.trim()
  for (let depth = 0; depth < 20; depth++) {
    const direct = blob.match(/itinerary=([^&]+)/)
    if (direct) {
      let v = direct[1]!
      for (let i = 0; i < 12; i++) {
        try {
          const next = decodeURIComponent(v.replace(/\+/g, "%20"))
          if (next === v) break
          v = next
        } catch {
          break
        }
      }
      return v
    }

    try {
      const u = new URL(blob)
      const nested = u.searchParams.get("pageUrl") ?? u.searchParams.get("u")
      if (nested) {
        blob = nested
        continue
      }
    } catch {
      /* try decode whole blob */
    }

    try {
      const next = decodeURIComponent(blob.replace(/\+/g, "%20"))
      if (next !== blob) {
        blob = next
        continue
      }
    } catch {
      break
    }
    break
  }
  return null
}

/** Parse full itinerary from a modal booking link (`Select` / redirect href). */
export const parseSkyscannerItineraryFromBookingHref = (href: string): SkyscannerItineraryLeg[] | null => {
  const raw = extractItineraryParamValue(href)
  if (!raw) return null
  const normalized = raw.replace(/,flight\|/g, ";flight|")
  const chunks = normalized
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("flight|"))

  const legs: SkyscannerItineraryLeg[] = []
  for (const chunk of chunks) {
    const leg = parseFlightChunk(chunk)
    if (leg) legs.push(leg)
  }
  return legs.length > 0 ? legs : null
}
