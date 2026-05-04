/** Short date label for compact UI (e.g. trip date trigger). */
export function fmtTripDateShort(iso: string): string {
  if (!iso) return ""
  const d = new Date(`${iso}T12:00:00Z`)
  if (!Number.isFinite(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d)
}
