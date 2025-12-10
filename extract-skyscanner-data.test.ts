import { test, expect } from "bun:test"
import { Effect } from "effect"
import { extractSkyscannerData } from "./extract-skyscanner-data"

test("extractSkyscannerData extracts correct data from HTML", async () => {
  // Read the HTML file
  const htmlFile = Bun.file("skyscanner-get-sample.html")
  const htmlString = await htmlFile.text()

  // Run the extraction function
  const result = await Effect.runPromise(extractSkyscannerData(htmlString))

  // Expected values from the HTML file (lines 777-788)
  const expected = {
    _token: "dfzDA8mvrCfeuoEhPVUoXdXfgsQXEa044JFYSz5I",
    session:
      "CrABS0xVdl9TQ056UU1BMGtnZEhLQzdBWl9mZjllWTV0SnA5dTg5S292SVRadmRxRkZXMWg4N3RSeU5FeUJkNFZMbmxHQ0ZjdW1yZEoyOWQ3WW90X0tiODExR0ZGVXBCV0E0ekxveWk0anRkVGYteFNXM1B6MXV3LS10Mzd4TGs2amt4OGtSRU83amM1UHo3QmkzVVVrM3d0ajc3WDVkem5fMm1nek04QlNBQUEwQkFBPT0iRgoCVVMSBWVuLUdCGgNFVVIiFwoFCgNCRVISBQoDTUFEGgcI6g8QAhgBIhcKBQoDTUFEEgUKA0JFUhoHCOoPEAIYBCgBMAEqJGY2MWRkYTk2LWQzNGQtNDg3OC1iOWIwLTg4NGExNmUzNThkMw==-cells1",
    suuid: "c5cfd964-ad43-490c-909f-b187ec23ac25",
    deeplink:
      "https://www.tkqlhce.com/click-3476948-11839040-1440520708000?sid=cff&amp;url=https://www.skyscanner.net/transport/flights/BER/MAD/260201/260204/?adults=1&amp;adultsv2=1&amp;children=0&amp;infants=0&amp;cabinclass=Economy&amp;rtn=1&amp;currency=EUR",
    s: "www",
    adults: "1",
    children: "0",
    infants: "0",
    currency: "EUR",
  }

  // Check all fields match expected values (except noc which is dynamic)
  expect(result._token).toBe(expected._token)
  expect(result.session).toBe(expected.session)
  expect(result.suuid).toBe(expected.suuid)
  expect(result.deeplink).toBe(expected.deeplink)
  expect(result.s).toBe(expected.s)
  expect(result.adults).toBe(expected.adults)
  expect(result.children).toBe(expected.children)
  expect(result.infants).toBe(expected.infants)
  expect(result.currency).toBe(expected.currency)

  // Check that noc is a string representing a timestamp
  expect(typeof result.noc).toBe("string")
  expect(result.noc).toMatch(/^\d+$/) // Should be numeric string
  expect(Number(result.noc)).toBeGreaterThan(0) // Should be a positive number
})

