import { test, expect } from "bun:test"
import { Effect } from "effect"
import { extractPollData } from "../extractPoll"

test("extractPollData extracts correct data from poll sample", async () => {
  // Read the poll HTML file
  const pollFile = Bun.file("../samples/poll.html")
  const pollString = await pollFile.text()

  // Run the extraction function
  const result = await Effect.runPromise(extractPollData(pollString))

  // Expected values from the first line: Y|500|...
  // Kiwi polls always return 'Y' (finished) as the first character
  expect(result.finished).toBe(true) // 'Y' should be true
  expect(result.count).toBe(500) // From the poll sample
  expect(typeof result.resultsHtml).toBe("string")
  expect(result.resultsHtml.length).toBeGreaterThan(0)
})
