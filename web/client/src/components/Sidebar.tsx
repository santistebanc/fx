import { StatSlider } from "./StatSlider"
import type { UiTrip } from "../lib/transformApiResponse"

function fmtDur(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function fmtPrice(price: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price)
}

export type Filters = {
  price: number
  duration: number
  stops: number
  layover: number
}

type SidebarProps = {
  trips: UiTrip[]
  filters: Filters
  setFilter: (key: keyof Filters, value: number) => void
  currentTrip: UiTrip | null
}

export function Sidebar({ trips, filters, setFilter, currentTrip }: SidebarProps) {
  if (trips.length === 0) return <aside className="sidebar" />

  const prices = trips.map(t => t.price)
  const durs = trips.map(t => t.stats.duration)
  const stops = trips.map(t => t.stats.stops)
  const layovers = trips.map(t => t.stats.layover)

  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const minDur = Math.min(...durs)
  const maxDur = Math.max(...durs)
  const maxStops = Math.max(...stops)
  const maxLayover = Math.max(...layovers)

  const tripPrice = currentTrip?.price ?? null
  const tripDur = currentTrip?.stats.duration ?? null
  const tripStops = currentTrip?.stats.stops ?? null
  const tripLayover = currentTrip?.stats.layover ?? null

  return (
    <aside className="sidebar">
      <div>
        <div className="filter-section-title">Filter Trips</div>
        <div className="stat-filter">
          <StatSlider
            label="Max Price"
            value={filters.price}
            min={minPrice}
            max={maxPrice}
            step={Math.max(1, Math.round((maxPrice - minPrice) / 100))}
            format={fmtPrice}
            onChange={v => setFilter("price", v)}
            tripValue={tripPrice}
          />
          <StatSlider
            label="Total Duration"
            value={filters.duration}
            min={minDur}
            max={maxDur}
            step={30}
            format={fmtDur}
            onChange={v => setFilter("duration", v)}
            tripValue={tripDur}
          />
          <StatSlider
            label="Max Stops"
            value={filters.stops}
            min={0}
            max={maxStops}
            step={1}
            format={v => String(v)}
            onChange={v => setFilter("stops", v)}
            tripValue={tripStops}
          />
          <StatSlider
            label="Total Layover"
            value={filters.layover}
            min={0}
            max={maxLayover}
            step={15}
            format={fmtDur}
            onChange={v => setFilter("layover", v)}
            tripValue={tripLayover}
          />
        </div>
      </div>
    </aside>
  )
}
