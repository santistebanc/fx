import { HttpRouter, HttpServer } from "@effect/platform"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { createServer } from "node:http"
import { initialHandler as skyscannerInitialHandler, pollHandler as skyscannerPollHandler } from "./skyscanner/fakeServer"
import { initialHandler as kiwiInitialHandler, pollHandler as kiwiPollHandler } from "./kiwi/fakeServer"
import { fakeServerPort } from "./utils"

const port = fakeServerPort()

const router = HttpRouter.empty.pipe(
  HttpRouter.get("/portal/sky", skyscannerInitialHandler),
  HttpRouter.post("/portal/sky/poll", skyscannerPollHandler),
  HttpRouter.get("/portal/kiwi", kiwiInitialHandler),
  HttpRouter.post("/portal/kiwi/search", kiwiPollHandler),
  HttpRouter.post("/portal/kiwi/poll", kiwiPollHandler)
)

const HttpLive = HttpServer.serve(router).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port }))
)

Effect.gen(function* () {
  yield* Effect.log(`Server running on http://localhost:${port}`)
  yield* Effect.log("Skyscanner endpoints:")
  yield* Effect.log(`  GET  http://localhost:${port}/portal/sky`)
  yield* Effect.log(`  POST http://localhost:${port}/portal/sky/poll`)
  yield* Effect.log("Kiwi endpoints:")
  yield* Effect.log(`  GET  http://localhost:${port}/portal/kiwi`)
  yield* Effect.log(`  POST http://localhost:${port}/portal/kiwi/search`)
  return yield* Layer.launch(HttpLive)
}).pipe(NodeRuntime.runMain)
