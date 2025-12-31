import { Effect, Layer } from "effect"
import { NodeHttpClient } from "@effect/platform-node"
import { type SearchInput, type SearchResult } from "../schemas"
import { search } from "./search"
import { KiwiConfigFake, KiwiConfigReal } from "./config"
import type { InitialRequestError } from "./requests"
import type { ExtractInitialDataError } from "./extractInitial"
import type { PollRequestError } from "./requests"
import type { PollMaxRetriesError } from "./search"
import type { ParseHtmlError } from "./parseHtml"

type SearchError = InitialRequestError | ExtractInitialDataError | PollRequestError | PollMaxRetriesError | ParseHtmlError

/**
 * Search with fake endpoints (for testing)
 */
export const searchWithFake = (searchInput: SearchInput): Effect.Effect<SearchResult, SearchError, never> =>
  search(searchInput).pipe(
    Effect.provide(Layer.merge(KiwiConfigFake, NodeHttpClient.layer))
  )

/**
 * Search with real endpoints (for production)
 */
export const searchWithReal = (searchInput: SearchInput): Effect.Effect<SearchResult, SearchError, never> =>
  search(searchInput).pipe(
    Effect.provide(Layer.merge(KiwiConfigReal, NodeHttpClient.layer))
  )
