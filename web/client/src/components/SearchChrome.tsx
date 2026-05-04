import { useMemo, useState } from "react"
import { DateModal } from "./DateModal"
import type { ApiPayload } from "../lib/transformApiResponse"

type SearchChromeProps = {
  onSearch: (body: Record<string, unknown>) => Promise<void>
  onDemo: (applyInput?: (inp: NonNullable<ApiPayload["input"]>) => void) => Promise<void>
  busy: boolean
}

function fmtShort(iso: string): string {
  const d = new Date(iso + "T12:00:00Z")
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

export function SearchChrome({ onSearch, onDemo, busy }: SearchChromeProps) {
  const [origin, setOrigin] = useState("BER")
  const [destination, setDestination] = useState("MAD")
  const [departureDate, setDepartureDate] = useState("2026-07-15")
  const [returnDate, setReturnDate] = useState("2026-07-22")
  const [roundTrip, setRoundTrip] = useState(true)
  const [dateOpen, setDateOpen] = useState(false)

  const dateSummary = useMemo(() => {
    if (!departureDate) return "Select dates"
    if (roundTrip && returnDate) return `${fmtShort(departureDate)} → ${fmtShort(returnDate)}`
    return fmtShort(departureDate)
  }, [departureDate, returnDate, roundTrip])

  function applyInput(inp: NonNullable<ApiPayload["input"]>) {
    if (inp.origin) setOrigin(inp.origin.trim().toUpperCase().slice(0, 3))
    if (inp.destination) setDestination(inp.destination.trim().toUpperCase().slice(0, 3))
    if (inp.departureDate) setDepartureDate(inp.departureDate)
    if (inp.returnDate) {
      setRoundTrip(true)
      setReturnDate(String(inp.returnDate))
    } else {
      setRoundTrip(false)
      setReturnDate("")
    }
  }

  async function handleSearch() {
    const o = origin.trim().toUpperCase().slice(0, 3)
    const d = destination.trim().toUpperCase().slice(0, 3)
    setOrigin(o)
    setDestination(d)
    await onSearch({
      origin: o,
      destination: d,
      departureDate,
      returnDate: roundTrip ? returnDate : undefined,
      sources: ["skyscanner", "kiwi"],
    })
  }

  return (
    <>
      <header className="search-bar">
        <div className="search-row">
          <span className="brand">fly<span>scan</span></span>
          <div className="search-divider" />

          <div className="sf-group sf-group--airport">
            <span className="sf-label">Origin</span>
            <input
              className="sf-val sf-input"
              value={origin}
              maxLength={3}
              autoCapitalize="characters"
              spellCheck={false}
              onChange={e => setOrigin(e.target.value)}
              onBlur={() => setOrigin(v => v.trim().toUpperCase().slice(0, 3))}
            />
          </div>

          <div className="sf-group sf-group--airport">
            <span className="sf-label">Destination</span>
            <input
              className="sf-val sf-input"
              value={destination}
              maxLength={3}
              autoCapitalize="characters"
              spellCheck={false}
              onChange={e => setDestination(e.target.value)}
              onBlur={() => setDestination(v => v.trim().toUpperCase().slice(0, 3))}
            />
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

          <button className="search-btn" type="button" disabled={busy} onClick={() => void handleSearch()}>
            {busy ? "Searching…" : "Search flights"}
          </button>
          <button className="demo-btn" type="button" disabled={busy} onClick={() => void onDemo(applyInput)}>
            {busy ? "Loading…" : "Demo"}
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
