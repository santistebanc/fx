import { HttpClientResponse } from "@effect/platform"

/** Port for standalone `bun run serve` fake portal (`PORT`, default 3000). */
export const fakeServerPort = (): number => {
  const n = Number(process.env.PORT)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3000
}

/**
 * Base URL for `/portal/*` when scraping in fake mode.
 * `FIXTURE_HTTP_ORIGIN` is set by `bun run web` so fixtures are served on the same port.
 * Otherwise uses `PORT` for standalone `bun run serve` (default 3000).
 */
export const fakeServerOrigin = (): string => {
  const embedded = process.env.FIXTURE_HTTP_ORIGIN?.trim()
  if (embedded) return embedded.replace(/\/$/, "")
  return `http://127.0.0.1:${fakeServerPort()}`
}

/** `data-price` on `.list-item.row` is integer cents (e.g. 36100 = €361.00). */
export const priceCentsFromDataPriceAttr = (attr: string | undefined): number | null => {
  if (attr == null || attr.trim() === "") return null
  const n = Number.parseInt(attr.trim(), 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Parse visible EUR amounts like €361, €1.234 (thousands), €99,99 / €99.99 into integer cents.
 * Avoids `/€(\d+)/` which reads €1.234 as €1.
 */
export const euroDisplayTextToCents = (text: string): number => {
  const euroIdx = text.indexOf("€")
  if (euroIdx === -1) return 0
  let raw = text.slice(euroIdx + 1).trim().replace(/\s/g, "")
  const head = raw.match(/^[\d.,]+/)
  if (!head) return 0
  raw = head[0]
  const endsCommaCents = /,\d{2}$/.test(raw)
  const endsDotCents = /\.\d{2}$/.test(raw)
  let normalized: string
  if (endsCommaCents && !endsDotCents) {
    normalized = raw.replace(/\./g, "").replace(",", ".")
  } else if (endsDotCents && !endsCommaCents) {
    normalized = raw.replace(/,/g, "")
  } else if (endsCommaCents && endsDotCents) {
    const lastComma = raw.lastIndexOf(",")
    const lastDot = raw.lastIndexOf(".")
    normalized = lastComma > lastDot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "")
  } else {
    normalized = raw.replace(/[.,]/g, "")
  }
  const euros = Number.parseFloat(normalized)
  if (!Number.isFinite(euros)) return 0
  return Math.round(euros * 100)
}

/** Prefer row `data-price` (cents); fall back to `.prices` text. */
export const listItemPriceCents = (
  rowAttr: string | undefined,
  pricesElementText: string
): number => priceCentsFromDataPriceAttr(rowAttr) ?? euroDisplayTextToCents(pricesElementText)

/** FlightsFinder portal poll/search body: `Y|count|…|…|` then HTML. Production Kiwi often omits the newline before `<`. */
export const splitPortalPollHeaderAndHtml = (
  pollString: string
): { headerLine: string; resultsHtml: string } => {
  const s = pollString.replace(/^\uFEFF/, "")
  const inlineHeader = /^(?:Y|N)\|\d+\|[^|]*\|[^|]*\|/
  const inlineMatch = s.match(inlineHeader)
  if (inlineMatch) {
    const matched = inlineMatch[0]
    return {
      headerLine: matched.slice(0, -1),
      resultsHtml: s.slice(matched.length),
    }
  }
  const idx = s.search(/\r?\n/)
  if (idx === -1) {
    return { headerLine: s.trimEnd(), resultsHtml: "" }
  }
  const headerLine = s.slice(0, idx).trimEnd()
  const resultsHtml = s.slice(idx).replace(/^\r?\n/, "")
  return { headerLine, resultsHtml }
}

/**
 * Extracts cookies from Set-Cookie headers
 */
export const extractCookies = (response: HttpClientResponse.HttpClientResponse): string => {
  const setCookieHeaders = response.headers["set-cookie"]
  if (!setCookieHeaders) {
    return ""
  }
  
  const headersArray = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders]
  
  return headersArray
    .filter((cookie): cookie is string => typeof cookie === "string")
    .map((cookie) => {
      // Extract just the name=value part (before the first semicolon)
      const match = cookie.match(/^([^;]+)/)
      return match ? match[1] : cookie
    })
    .join("; ")
}

/**
 * Parses cookies from a cookie string and merges with new cookies
 */
export const mergeCookies = (existing: string, newCookies: string): string => {
  const cookieMap = new Map<string, string>()
  
  // Parse existing cookies
  if (existing) {
    existing.split("; ").forEach((cookie) => {
      const [name, value] = cookie.split("=", 2)
      if (name && value) {
        cookieMap.set(name.trim(), value.trim())
      }
    })
  }
  
  // Parse and merge new cookies
  if (newCookies) {
    newCookies.split("; ").forEach((cookie) => {
      const [name, value] = cookie.split("=", 2)
      if (name && value) {
        cookieMap.set(name.trim(), value.trim())
      }
    })
  }
  
  // Rebuild cookie string
  return Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ")
}
