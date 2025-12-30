import { test, expect } from "bun:test"
import { Effect } from "effect"
import { extractPollData } from "./extract-poll-data"

test("extractPollData extracts correct data from poll-0 sample", async () => {
  // Read the poll-0 HTML file
  const pollFile = Bun.file("poll-0-sample.html")
  const pollString = await pollFile.text()

  // Run the extraction function
  const result = await Effect.runPromise(extractPollData(pollString))

  // Expected values from the first line: N|530|...
  expect(result.finished).toBe(false) // 'N' should be false
  expect(result.count).toBe(530)
  expect(typeof result.resultsHtml).toBe("string")
  expect(result.resultsHtml.length).toBeGreaterThan(0)
})

test("extractPollData extracts correct data from poll-1 sample", async () => {
  // Read the poll-1 HTML file
  const pollFile = Bun.file("poll-1-sample.html")
  const pollString = await pollFile.text()

  // Run the extraction function
  const result = await Effect.runPromise(extractPollData(pollString))

  // Expected values from the first line: Y|534|...
  expect(result.finished).toBe(true) // 'Y' should be true
  expect(result.count).toBe(534)
  expect(typeof result.resultsHtml).toBe("string")
  expect(result.resultsHtml.length).toBeGreaterThan(0)
})

