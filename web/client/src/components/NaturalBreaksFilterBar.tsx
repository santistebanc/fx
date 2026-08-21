import { useMemo } from "react"
import { StatSlider } from "./StatSlider"

type ClusterOption = {
  max: number
  threshold: number
  count: number
}

export type NiceBreakStep = {
  step: number
  mode: "floor" | "ceil"
}

type NaturalBreaksFilterBarProps = {
  label: string
  min: number
  max: number
  value: number
  values: number[]
  step: number
  niceBreakSteps: NiceBreakStep[]
  format: (v: number) => string
  onChange: (v: number) => void
  tripValue?: number | null
  noAdditionFrom?: number | null
  noAdditionUntil?: number | null
  hasCurrentResults?: boolean
  hideLabel?: boolean
}

const MIN_CLUSTER_COUNT = 6
const MAX_CLUSTER_COUNT = 32
const ANYTHING_BREAK_STEP: NiceBreakStep = { step: 1, mode: "ceil" }

function roundedThreshold(currentMax: number, nextMin: number | undefined, steps: NiceBreakStep[]): number {
  if (nextMin == null || nextMin <= currentMax) return currentMax

  for (const { step, mode } of [...steps, ANYTHING_BREAK_STEP]) {
    if (step <= 0) continue
    const rounded = mode === "floor"
      ? Math.floor(nextMin / step) * step
      : Math.ceil(currentMax / step) * step
    if (rounded >= currentMax && rounded < nextMin) return rounded
  }

  return currentMax
}

function fisherJenksClusters(values: number[], targetCount: number): number[][] {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  const n = sorted.length
  if (n === 0) return []

  const uniqueCount = new Set(sorted).size
  const k = Math.max(1, Math.min(targetCount, uniqueCount, n))
  if (k === 1) return [sorted]

  const lower: number[][] = Array.from({ length: n + 1 }, () => Array(k + 1).fill(0))
  const variance: number[][] = Array.from({ length: n + 1 }, () => Array(k + 1).fill(Infinity))

  for (let i = 1; i <= k; i++) {
    lower[1]![i] = 1
    variance[1]![i] = 0
  }

  for (let l = 2; l <= n; l++) {
    let sum = 0
    let sumSquares = 0
    let count = 0

    for (let m = 1; m <= l; m++) {
      const lowerClassLimit = l - m + 1
      const value = sorted[lowerClassLimit - 1]!
      count++
      sum += value
      sumSquares += value * value
      const clusterVariance = sumSquares - (sum * sum) / count

      if (lowerClassLimit !== 1) {
        for (let j = 2; j <= k; j++) {
          const candidate = clusterVariance + variance[lowerClassLimit - 1]![j - 1]!
          if (candidate < variance[l]![j]!) {
            lower[l]![j] = lowerClassLimit
            variance[l]![j] = candidate
          }
        }
      }
    }

    lower[l]![1] = 1
    variance[l]![1] = sumSquares - (sum * sum) / count
  }

  const clusters: number[][] = Array.from({ length: k }, () => [])
  let end = n
  for (let j = k; j >= 1; j--) {
    const start = lower[end]![j] || 1
    clusters[j - 1] = sorted.slice(start - 1, end)
    end = start - 1
  }

  return clusters.filter(cluster => cluster.length > 0)
}

function targetClusterCount(values: number[]): number {
  const uniqueCount = new Set(values).size
  if (uniqueCount <= 1) return 1
  const dataScaledCount = Math.ceil(Math.sqrt(values.length) * 1.6)
  return Math.max(1, Math.min(MAX_CLUSTER_COUNT, uniqueCount, Math.max(MIN_CLUSTER_COUNT, dataScaledCount)))
}

function naturalBreakClusters(values: number[]): number[][] {
  const uniqueCount = new Set(values).size
  if (uniqueCount <= 1) return [values.filter(Number.isFinite).sort((a, b) => a - b)]
  return fisherJenksClusters(values, targetClusterCount(values))
}

function naturalBreakOptions(values: number[], niceBreakSteps: NiceBreakStep[]): ClusterOption[] {
  const clean = values.filter(Number.isFinite)
  if (clean.length === 0) return []

  const clusters = naturalBreakClusters(clean)
  const options = clusters.map((cluster, index) => {
    const max = cluster[cluster.length - 1]!
    return {
      max,
      threshold: roundedThreshold(max, clusters[index + 1]?.[0], niceBreakSteps),
      count: cluster.length,
    }
  })

  const deduped: ClusterOption[] = []
  for (const option of options) {
    const last = deduped[deduped.length - 1]
    if (last && last.threshold === option.threshold) {
      last.max = Math.max(last.max, option.max)
      last.count += option.count
    }
    else deduped.push({ ...option })
  }
  return deduped
}

export function NaturalBreaksFilterBar({
  label,
  min,
  max,
  value,
  values,
  step,
  niceBreakSteps,
  format,
  onChange,
  tripValue,
  noAdditionFrom,
  noAdditionUntil,
  hasCurrentResults = true,
  hideLabel,
}: NaturalBreaksFilterBarProps) {
  const options = useMemo(
    () => naturalBreakOptions(values.filter(v => v >= min && v <= max), niceBreakSteps),
    [min, max, niceBreakSteps, values],
  )
  const snapPoints = useMemo(
    () => options.map(option => option.threshold),
    [options],
  )

  return (
    <div className="stat-row">
      {!hideLabel && (
        <div className="stat-head">
          <span className="stat-name">{label}</span>
        </div>
      )}
      <StatSlider
        label={label}
        hideLabel
        value={value}
        min={min}
        max={max}
        step={step}
        format={format}
        onChange={onChange}
        tripValue={tripValue}
        noAdditionFrom={noAdditionFrom}
        noAdditionUntil={noAdditionUntil}
        hasCurrentResults={hasCurrentResults}
        snapPoints={snapPoints}
      />
    </div>
  )
}
