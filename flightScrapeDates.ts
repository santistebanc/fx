/**
 * Portal modals show local departure/arrival clocks under one heading date.
 * When arrival clock is not after departure clock, arrival is almost always the next calendar day
 * (overnight leg or westbound long-haul where clocks cross differently).
 */

export const parseClockMinutesFromPortal = (time: string): number | null => {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number.parseInt(m[1]!, 10)
  const min = Number.parseInt(m[2]!, 10)
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

export const addCalendarDaysIso = (isoDate: string, days: number): string => {
  const d = new Date(isoDate + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const inferArrivalDateIsoFromPortalClocks = (params: {
  departure_date: string
  departure_time: string
  arrival_time: string
}): string => {
  const depM = parseClockMinutesFromPortal(params.departure_time)
  const arrM = parseClockMinutesFromPortal(params.arrival_time)
  if (depM == null || arrM == null) return params.departure_date
  if (arrM <= depM) return addCalendarDaysIso(params.departure_date, 1)
  return params.departure_date
}

/** Parse banner/summary text like "Sun, 1 Feb 2026" → ISO date. */
export const parsePortalHeadingDate = (dateText: string): string | null => {
  const match = dateText.trim().match(/(\d{1,2})\s+(\w+)\s+(\d{4})/)
  if (!match) return null
  const [, day, monthName, year] = match
  if (!day || !monthName || !year) return null
  const monthMap: Record<string, string> = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12",
  }
  const month = monthMap[monthName.substring(0, 3)]
  if (!month) return null
  return `${year}-${month}-${day.padStart(2, "0")}`
}

export const splitLocalIsoDateTime = (isoMinute: string): { date: string; time: string } | null => {
  const m = isoMinute.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/)
  if (!m) return null
  return { date: m[1]!, time: m[2]! }
}

/** Order-only timeline for chaining segments (not real TZ). */
export const naiveUtcMsFromLocalParts = (isoDate: string, hhmm: string): number => {
  const [y, mo, d] = isoDate.split("-").map(Number)
  const [hh, mm] = hhmm.split(":").map(Number)
  return Date.UTC(y, mo - 1, d, hh, mm, 0, 0)
}

/**
 * Next segment's departure calendar date: first local day where `nextDepartureTime`
 * is strictly after the previous leg's arrival instant (handles overnight connections).
 */
export const inferNextLegDepartureDateIso = (params: {
  prevArrivalDate: string
  prevArrivalTime: string
  nextDepartureTime: string
}): string => {
  const prevEnd = naiveUtcMsFromLocalParts(params.prevArrivalDate, params.prevArrivalTime)
  let candDate = params.prevArrivalDate
  for (let roll = 0; roll < 4; roll++) {
    const candMs = naiveUtcMsFromLocalParts(candDate, params.nextDepartureTime)
    if (candMs > prevEnd) return candDate
    candDate = addCalendarDaysIso(candDate, 1)
  }
  return candDate
}
