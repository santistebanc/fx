import { HttpClientResponse } from "@effect/platform"

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
