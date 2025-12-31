import { HttpRouter, HttpServer } from "@effect/platform"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { createServer } from "node:http"
import { initialHandler as skyscannerInitialHandler, pollHandler as skyscannerPollHandler } from "./skyscanner/fakeServer"
import { initialHandler as kiwiInitialHandler, pollHandler as kiwiPollHandler } from "./kiwi/fakeServer"

const router = HttpRouter.empty.pipe(
  HttpRouter.get("/portal/sky", skyscannerInitialHandler),
  HttpRouter.post("/portal/sky/poll", skyscannerPollHandler),
  HttpRouter.get("/portal/kiwi", kiwiInitialHandler),
  HttpRouter.post("/portal/kiwi/poll", kiwiPollHandler)
)

const HttpLive = HttpServer.serve(router).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 }))
)

Effect.gen(function* () {
  yield* Effect.log("Server running on http://localhost:3000")
  yield* Effect.log("Skyscanner endpoints:")
  yield* Effect.log("  GET  http://localhost:3000/portal/sky")
  yield* Effect.log("  POST http://localhost:3000/portal/sky/poll")
  yield* Effect.log("Kiwi endpoints:")
  yield* Effect.log("  GET  http://localhost:3000/portal/kiwi")
  yield* Effect.log("  POST http://localhost:3000/portal/kiwi/poll")
  return yield* Layer.launch(HttpLive)
}).pipe(NodeRuntime.runMain)
