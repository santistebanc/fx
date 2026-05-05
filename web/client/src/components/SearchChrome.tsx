import { useEffect, useMemo, useState, type MutableRefObject } from "react"
import { DateModal } from "./DateModal"
import type { ApiPayload } from "../lib/transformApiResponse"
import {
  filterRecentAirports,
  readRecentAirports,
  rememberAirport,
  type StoredAirport,
} from "../lib/recentAirports"

type SearchChromeProps = {
  onSearch: (body: Record<string, unknown>) => Promise<void>
  busy: boolean
  /** Filled by this component so the parent can apply fixture `input` from the devtools console. */
  fixtureApplyRef?: MutableRefObject<((inp: NonNullable<ApiPayload["input"]>) => void) | null>
}

type AirportSuggestion = {
  code: string
  label: string
}

const apiOrigin = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "")
const apiUrl = (path: string) => `${apiOrigin}${path}`

function mergeSuggestions(recent: AirportSuggestion[], remote: AirportSuggestion[]): AirportSuggestion[] {
  const seen = new Set<string>()
  const out: AirportSuggestion[] = []
  for (const s of recent) {
    if (seen.has(s.code)) continue
    seen.add(s.code)
    out.push(s)
  }
  for (const s of remote) {
    if (seen.has(s.code)) continue
    seen.add(s.code)
    out.push(s)
  }
  return out
}

function fmtShort(iso: string): string {
  const d = new Date(iso + "T12:00:00Z")
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function toIataOrBestEffort(raw: string): string {
  const trimmed = raw.trim()
  const upper = trimmed.toUpperCase()
  if (/^[A-Z]{3}$/.test(upper)) return upper
  const inParens = upper.match(/\(([A-Z]{3})\)/)
  if (inParens?.[1]) return inParens[1]
  const anyCode = upper.match(/\b([A-Z]{3})\b/)
  if (anyCode?.[1]) return anyCode[1]
  return upper.slice(0, 3)
}

export function SearchChrome({ onSearch, busy, fixtureApplyRef }: SearchChromeProps) {
  const [origin, setOrigin] = useState("BER")
  const [destination, setDestination] = useState("MAD")
  const [departureDate, setDepartureDate] = useState("2026-07-15")
  const [returnDate, setReturnDate] = useState("2026-07-22")
  const [roundTrip, setRoundTrip] = useState(true)
  const [dateOpen, setDateOpen] = useState(false)
  const [originFocus, setOriginFocus] = useState(false)
  const [destinationFocus, setDestinationFocus] = useState(false)
  const [originRemote, setOriginRemote] = useState<AirportSuggestion[]>([])
  const [destinationRemote, setDestinationRemote] = useState<AirportSuggestion[]>([])
  const [originLoading, setOriginLoading] = useState(false)
  const [destinationLoading, setDestinationLoading] = useState(false)
  const [recents, setRecents] = useState<StoredAirport[]>(() => readRecentAirports())

  function refreshRecents() {
    setRecents(readRecentAirports())
  }

  const dateSummary = useMemo(() => {
    if (!departureDate) return "Select dates"
    if (roundTrip && returnDate) return `${fmtShort(departureDate)} → ${fmtShort(returnDate)}`
    return fmtShort(departureDate)
  }, [departureDate, returnDate, roundTrip])

  useEffect(() => {
    if (!fixtureApplyRef) return
    fixtureApplyRef.current = (inp: NonNullable<ApiPayload["input"]>) => {
      if (inp.origin) {
        const o = toIataOrBestEffort(inp.origin)
        setOrigin(o)
        if (/^[A-Z]{3}$/.test(o)) rememberAirport(o)
      }
      if (inp.destination) {
        const d = toIataOrBestEffort(inp.destination)
        setDestination(d)
        if (/^[A-Z]{3}$/.test(d)) rememberAirport(d)
      }
      refreshRecents()
      if (inp.departureDate) setDepartureDate(inp.departureDate)
      if (inp.returnDate) {
        setRoundTrip(true)
        setReturnDate(String(inp.returnDate))
      } else {
        setRoundTrip(false)
        setReturnDate("")
      }
    }
    return () => {
      fixtureApplyRef.current = null
    }
  }, [fixtureApplyRef])

  async function handleSearch() {
    const o = toIataOrBestEffort(origin)
    const d = toIataOrBestEffort(destination)
    setOrigin(o)
    setDestination(d)
    rememberAirport(o)
    rememberAirport(d)
    refreshRecents()
    await onSearch({
      origin: o,
      destination: d,
      departureDate,
      returnDate: roundTrip ? returnDate : undefined,
      sources: ["skyscanner", "kiwi"],
    })
  }

  useEffect(() => {
    const term = origin.trim()
    if (term.length < 2) {
      setOriginRemote([])
      setOriginLoading(false)
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setOriginLoading(true)
      setOriginRemote([])
      try {
        const res = await fetch(apiUrl(`/api/airports?term=${encodeURIComponent(term)}`), { signal: ctrl.signal })
        const data = await res.json().catch(() => ({} as { suggestions?: AirportSuggestion[] }))
        const suggestions = Array.isArray(data.suggestions) ? data.suggestions : []
        setOriginRemote(suggestions)
      } catch {
        // Ignore abort/network errors in autocomplete and fall back to manual input.
      } finally {
        setOriginLoading(false)
      }
    }, 180)
    return () => {
      ctrl.abort()
      clearTimeout(t)
    }
  }, [origin])

  useEffect(() => {
    const term = destination.trim()
    if (term.length < 2) {
      setDestinationRemote([])
      setDestinationLoading(false)
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setDestinationLoading(true)
      setDestinationRemote([])
      try {
        const res = await fetch(apiUrl(`/api/airports?term=${encodeURIComponent(term)}`), { signal: ctrl.signal })
        const data = await res.json().catch(() => ({} as { suggestions?: AirportSuggestion[] }))
        const suggestions = Array.isArray(data.suggestions) ? data.suggestions : []
        setDestinationRemote(suggestions)
      } catch {
        // Ignore abort/network errors in autocomplete and fall back to manual input.
      } finally {
        setDestinationLoading(false)
      }
    }, 180)
    return () => {
      ctrl.abort()
      clearTimeout(t)
    }
  }, [destination])

  const originRecentMatches = useMemo(
    () =>
      filterRecentAirports(recents, origin).map((r) => ({
        code: r.code,
        label: r.label,
      })),
    [recents, origin],
  )
  const destinationRecentMatches = useMemo(
    () =>
      filterRecentAirports(recents, destination).map((r) => ({
        code: r.code,
        label: r.label,
      })),
    [recents, destination],
  )

  const originSuggestions = useMemo(
    () => mergeSuggestions(originRecentMatches, originRemote),
    [originRecentMatches, originRemote],
  )
  const destinationSuggestions = useMemo(
    () => mergeSuggestions(destinationRecentMatches, destinationRemote),
    [destinationRecentMatches, destinationRemote],
  )

  const originRecentCodes = useMemo(() => new Set(originRecentMatches.map((r) => r.code)), [originRecentMatches])
  const destinationRecentCodes = useMemo(
    () => new Set(destinationRecentMatches.map((r) => r.code)),
    [destinationRecentMatches],
  )

  const showOriginSuggestions =
    originFocus && (originLoading || originSuggestions.length > 0)
  const showDestinationSuggestions =
    destinationFocus && (destinationLoading || destinationSuggestions.length > 0)

  return (
    <>
      <header className="search-bar">
        <div className="search-row">
          <span className="brand">fly<span>scan</span></span>
          <div className="search-divider" />

          <div className="sf-group sf-group--airport">
            <span className="sf-label">FROM</span>
            <input
              className="sf-val sf-input"
              value={origin}
              maxLength={40}
              autoCapitalize="characters"
              spellCheck={false}
              onChange={e => setOrigin(e.target.value)}
              onFocus={() => setOriginFocus(true)}
              onBlur={() => {
                setOriginFocus(false)
                const raw = origin.trim()
                const n = toIataOrBestEffort(raw)
                setOrigin(/^[A-Z]{3}$/.test(n) ? n : raw)
                if (/^[A-Z]{3}$/.test(n)) rememberAirport(n)
                refreshRecents()
              }}
            />
            {showOriginSuggestions && (
              <div className="airport-suggest">
                {originSuggestions.map((s) => (
                  <button
                    key={`${s.code}-${s.label}`}
                    type="button"
                    className={`airport-suggest-item${originRecentCodes.has(s.code) ? " airport-suggest-item--recent" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setOrigin(s.code)
                      rememberAirport(s.code, s.label)
                      refreshRecents()
                      setOriginRemote([])
                      setOriginFocus(false)
                    }}
                  >
                    <span className="airport-suggest-code">{s.code}</span>
                    <span className="airport-suggest-label">{s.label}</span>
                  </button>
                ))}
                {originLoading && origin.trim().length >= 2 && (
                  <div className="airport-suggest-item airport-suggest-item--hint">Searching…</div>
                )}
              </div>
            )}
          </div>

          <div className="sf-group sf-group--airport">
            <span className="sf-label">TO</span>
            <input
              className="sf-val sf-input"
              value={destination}
              maxLength={40}
              autoCapitalize="characters"
              spellCheck={false}
              onChange={e => setDestination(e.target.value)}
              onFocus={() => setDestinationFocus(true)}
              onBlur={() => {
                setDestinationFocus(false)
                const raw = destination.trim()
                const n = toIataOrBestEffort(raw)
                setDestination(/^[A-Z]{3}$/.test(n) ? n : raw)
                if (/^[A-Z]{3}$/.test(n)) rememberAirport(n)
                refreshRecents()
              }}
            />
            {showDestinationSuggestions && (
              <div className="airport-suggest">
                {destinationSuggestions.map((s) => (
                  <button
                    key={`${s.code}-${s.label}`}
                    type="button"
                    className={`airport-suggest-item${destinationRecentCodes.has(s.code) ? " airport-suggest-item--recent" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setDestination(s.code)
                      rememberAirport(s.code, s.label)
                      refreshRecents()
                      setDestinationRemote([])
                      setDestinationFocus(false)
                    }}
                  >
                    <span className="airport-suggest-code">{s.code}</span>
                    <span className="airport-suggest-label">{s.label}</span>
                  </button>
                ))}
                {destinationLoading && destination.trim().length >= 2 && (
                  <div className="airport-suggest-item airport-suggest-item--hint">Searching…</div>
                )}
              </div>
            )}
          </div>

          <div className="search-divider" />

          <button
            className="sf-group"
            onClick={() => setDateOpen(true)}
            style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
            type="button"
          >
            <span className="sf-label">Dates</span>
            <span className="sf-val">{dateSummary}</span>
          </button>

          <div className="search-divider" />

          <button
            className="search-btn"
            type="button"
            disabled={busy}
            aria-busy={busy || undefined}
            aria-label={busy ? "Searching" : "Search"}
            onClick={() => void handleSearch()}
          >
            <svg className="search-btn-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
              />
            </svg>
            <span className="search-btn-label">{busy ? "Searching…" : "Search"}</span>
          </button>
        </div>
      </header>

      {dateOpen && (
        <DateModal
          depDate={departureDate}
          retDate={returnDate}
          roundTrip={roundTrip}
          onClose={() => setDateOpen(false)}
          onApply={({ dep, ret, isRound }) => {
            setDepartureDate(dep)
            setReturnDate(ret)
            setRoundTrip(isRound)
            setDateOpen(false)
          }}
        />
      )}
    </>
  )
}
