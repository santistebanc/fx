/** Pure facet metrics — safe to run in a Web Worker (no DOM). */

export type Bounds = { lo: number; hi: number }

export interface FacetState {
  priceMin: number
  priceMax: number
  minStops: number
  maxStops: number
  minDurMin: number
  maxDurMin: number
  minLayoverMin: number
  maxLayoverMin: number
}

export type FacetExclude = "price" | "stops" | "dur" | "lay"

/** Trimmed trip row for cross-filter scans (no Deal objects). */
export interface FacetCompactRow {
  readonly sortedDealPrices: readonly number[]
  readonly offerCount: number
  readonly minPrice: number
  readonly maxPrice: number
  readonly totalStops: number
  readonly totalDurMin: number | null
  readonly totalLayoverMin: number
}

export interface FacetMetricsResult {
  bp: Bounds
  bs: Bounds
  bd: Bounds
  bl: Bounds
  filteredCount: number
  filteredOfferCount: number
}

/** First index i with sorted[i] >= x (sorted ascending). */
export function lowerBoundSorted(sorted: readonly number[], x: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid]! < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** True iff some price in sorted ascending array lies in [rangeLo, rangeHi]. */
export function sortedPricesOverlapRange(sorted: readonly number[], rangeLo: number, rangeHi: number): boolean {
  if (sorted.length === 0 || rangeLo > rangeHi) return false
  const i = lowerBoundSorted(sorted, rangeLo)
  return i < sorted.length && sorted[i]! <= rangeHi
}

function matchesPriceFacetRow(p: FacetCompactRow, s: FacetState): boolean {
  return sortedPricesOverlapRange(p.sortedDealPrices, s.priceMin, s.priceMax)
}

function matchesStopsFacetRow(p: FacetCompactRow, s: FacetState): boolean {
  return p.totalStops != null && p.totalStops >= s.minStops && p.totalStops <= s.maxStops
}

function matchesDurFacetRow(p: FacetCompactRow, s: FacetState): boolean {
  return p.totalDurMin == null || (p.totalDurMin >= s.minDurMin && p.totalDurMin <= s.maxDurMin)
}

function matchesLayFacetRow(p: FacetCompactRow, s: FacetState): boolean {
  return p.totalLayoverMin >= s.minLayoverMin && p.totalLayoverMin <= s.maxLayoverMin
}

function facetPassRow(p: FacetCompactRow, s: FacetState, exclude: FacetExclude | null): boolean {
  if (exclude !== "price" && !matchesPriceFacetRow(p, s)) return false
  if (exclude !== "stops" && !matchesStopsFacetRow(p, s)) return false
  if (exclude !== "dur" && !matchesDurFacetRow(p, s)) return false
  if (exclude !== "lay" && !matchesLayFacetRow(p, s)) return false
  return true
}

/**
 * Cross-filter feasible envelope per dimension plus filtered trip count.
 * Single pass over rows.
 */
export function facetMetricsForCompactRows(
  state: FacetState,
  rows: readonly FacetCompactRow[],
  fullPrice: Bounds,
  fullStops: Bounds,
  fullDur: Bounds,
  fullLay: Bounds
): FacetMetricsResult {
  let bpLo = Infinity
  let bpHi = -Infinity
  let bpAny = false

  let bsLo = Infinity
  let bsHi = -Infinity
  let bsAny = false

  let bdLo = Infinity
  let bdHi = -Infinity
  let bdAny = false

  let blLo = Infinity
  let blHi = -Infinity
  let blAny = false

  let filteredCount = 0
  let filteredOfferCount = 0

  for (const p of rows) {
    if (facetPassRow(p, state, null)) {
      filteredCount++
      filteredOfferCount += p.offerCount
    }

    if (facetPassRow(p, state, "price")) {
      bpAny = true
      bpLo = Math.min(bpLo, p.minPrice)
      bpHi = Math.max(bpHi, p.maxPrice)
    }

    if (facetPassRow(p, state, "stops")) {
      const ts = p.totalStops
      if (ts != null) {
        bsAny = true
        bsLo = Math.min(bsLo, ts)
        bsHi = Math.max(bsHi, ts)
      }
    }

    if (facetPassRow(p, state, "dur")) {
      const v = p.totalDurMin
      if (v != null && !Number.isNaN(v)) {
        bdAny = true
        bdLo = Math.min(bdLo, v)
        bdHi = Math.max(bdHi, v)
      }
    }

    if (facetPassRow(p, state, "lay")) {
      const v = p.totalLayoverMin
      if (v != null && !Number.isNaN(v)) {
        blAny = true
        blLo = Math.min(blLo, v)
        blHi = Math.max(blHi, v)
      }
    }
  }

  return {
    bp: bpAny ? { lo: bpLo, hi: bpHi } : fullPrice,
    bs: bsAny ? { lo: bsLo, hi: bsHi } : fullStops,
    bd: bdAny ? { lo: bdLo, hi: bdHi } : fullDur,
    bl: blAny ? { lo: blLo, hi: blHi } : fullLay,
    filteredCount,
    filteredOfferCount,
  }
}
