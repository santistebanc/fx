import { test, expect } from "bun:test"
import { Effect } from "effect"
import { extractInitialData } from "../extractInitial"

test("extractInitialData extracts correct data from HTML", async () => {
  // Read the HTML file
  const htmlFile = Bun.file("../samples/initial.html")
  const htmlString = await htmlFile.text()

  // Run the extraction function
  const result = await Effect.runPromise(extractInitialData(htmlString))

  // Expected values from the HTML file (lines 825-838)
  const expected = {
    _token: "FG3HGgkf4dFY7gFfCxAXxrfhGJkL4bmB6LKV4yyg",
    originplace: "BER",
    destinationplace: "MAD",
    outbounddate: "01/02/2026",
    inbounddate: "04/02/2026",
    cabinclass: "M",
    adults: "1",
    children: "0",
    infants: "0",
    currency: "EUR",
    type: "return",
    "bags-cabin": "0",
    "bags-checked": "0",
  }

  // Check all fields match expected values (except noc which is dynamic)
  expect(result._token).toBe(expected._token)
  expect(result.originplace).toBe(expected.originplace)
  expect(result.destinationplace).toBe(expected.destinationplace)
  expect(result.outbounddate).toBe(expected.outbounddate)
  expect(result.inbounddate).toBe(expected.inbounddate)
  expect(result.cabinclass).toBe(expected.cabinclass)
  expect(result.adults).toBe(expected.adults)
  expect(result.children).toBe(expected.children)
  expect(result.infants).toBe(expected.infants)
  expect(result.currency).toBe(expected.currency)
  expect(result.type).toBe(expected.type)
  expect(result["bags-cabin"]).toBe(expected["bags-cabin"])
  expect(result["bags-checked"]).toBe(expected["bags-checked"])

  // Check that noc is a string representing a timestamp
  expect(typeof result.noc).toBe("string")
  expect(result.noc).toMatch(/^\d+$/) // Should be numeric string
  expect(Number(result.noc)).toBeGreaterThan(0) // Should be a positive number
})
