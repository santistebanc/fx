import { useEffect, useState } from "react"

export type AirportInfo = { city: string; country: string; name: string }

const cache = new Map<string, AirportInfo>()

const apiOrigin = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "")

async function fetchCodes(codes: string[]): Promise<void> {
  const missing = codes.filter((c) => !cache.has(c))
  if (missing.length === 0) return
  try {
    const res = await fetch(`${apiOrigin}/api/airport-info?codes=${missing.join(",")}`)
    if (!res.ok) return
    const data = (await res.json()) as Record<string, AirportInfo>
    for (const [code, info] of Object.entries(data)) cache.set(code, info)
  } catch {
    // best-effort
  }
}

export function useAirportInfo(codes: string[]): Record<string, AirportInfo> {
  const [info, setInfo] = useState<Record<string, AirportInfo>>({})
  const key = codes.slice().sort().join(",")

  useEffect(() => {
    if (codes.length === 0) return
    let cancelled = false
    fetchCodes(codes).then(() => {
      if (cancelled) return
      const result: Record<string, AirportInfo> = {}
      for (const code of codes) {
        const hit = cache.get(code)
        if (hit) result[code] = hit
      }
      setInfo(result)
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return info
}
