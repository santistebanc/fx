import { describe, expect, test } from "bun:test"
import {
  addCalendarDaysIso,
  inferArrivalDateIsoFromPortalClocks,
  parseClockMinutesFromPortal,
} from "./flightScrapeDates"

describe("flightScrapeDates", () => {
  test("parseClockMinutesFromPortal", () => {
    expect(parseClockMinutesFromPortal("06:15")).toBe(375)
    expect(parseClockMinutesFromPortal("22:20")).toBe(22 * 60 + 20)
    expect(parseClockMinutesFromPortal("bad")).toBeNull()
  })

  test("inferArrivalDateIsoFromPortalClocks rolls forward when arrival clock <= departure", () => {
    expect(
      inferArrivalDateIsoFromPortalClocks({
        departure_date: "2026-06-02",
        departure_time: "22:20",
        arrival_time: "17:20",
      })
    ).toBe("2026-06-03")
  })

  test("inferArrivalDateIsoFromPortalClocks keeps same day when arrival is strictly after departure", () => {
    expect(
      inferArrivalDateIsoFromPortalClocks({
        departure_date: "2026-06-02",
        departure_time: "12:13",
        arrival_time: "13:30",
      })
    ).toBe("2026-06-02")
  })

  test("addCalendarDaysIso", () => {
    expect(addCalendarDaysIso("2026-06-02", 1)).toBe("2026-06-03")
  })
})
