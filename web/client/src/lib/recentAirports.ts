const STORAGE_KEY = "flyscan.recentAirports.v1"
const MAX_RECENTS = 12

export type StoredAirport = {
  code: string
  label: string
  usedAt: number
}

function safeParse(raw: string | null): StoredAirport[] {
  if (!raw) return []
  try {
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return []
    return data
      .map((row): StoredAirport | null => {
        if (!row || typeof row !== "object") return null
        const r = row as Record<string, unknown>
        const code = typeof r.code === "string" ? r.code.trim().toUpperCase() : ""
        const label = typeof r.label === "string" ? r.label.trim() : ""
        const usedAt = typeof r.usedAt === "number" ? r.usedAt : 0
        if (!/^[A-Z]{3}$/.test(code)) return null
        return { code, label: label || code, usedAt }
      })
      .filter((x): x is StoredAirport => Boolean(x))
  } catch {
    return []
  }
}

export function readRecentAirports(): StoredAirport[] {
  if (typeof localStorage === "undefined") return []
  return safeParse(localStorage.getItem(STORAGE_KEY)).sort((a, b) => b.usedAt - a.usedAt)
}

export function rememberAirport(code: string, label?: string): void {
  if (typeof localStorage === "undefined") return
  const c = code.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(c)) return
  const prevAll = readRecentAirports()
  const existing = prevAll.find((x) => x.code === c)
  const lbl = (label?.trim() || existing?.label || c).slice(0, 200)
  const now = Date.now()
  const prev = prevAll.filter((x) => x.code !== c)
  const next = [{ code: c, label: lbl, usedAt: now }, ...prev].slice(0, MAX_RECENTS)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

/** Match recents for autocomplete: empty term → most recent; otherwise prefix / substring. */
export function filterRecentAirports(recents: StoredAirport[], termRaw: string): StoredAirport[] {
  const term = termRaw.trim().toUpperCase()
  if (term.length === 0) return recents.slice(0, 8)
  return recents
    .filter((r) => {
      if (term.length <= 3 && r.code.startsWith(term)) return true
      const hay = `${r.code} ${r.label}`.toUpperCase()
      return hay.includes(term)
    })
    .slice(0, 8)
}
