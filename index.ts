import { HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { DateTime, Effect, Layer } from "effect"
import { createServer } from "node:http"

// Define a handler that uses Effect to get the current time
const handler = Effect.gen(function* () {
  const now = yield* DateTime.now
  return yield* HttpServerResponse.json({
    message: "Hello from Effect!",
    timestamp: DateTime.formatIso(now),
    status: "ok",
  })
})

// Build the router with the Effect handler
const router = HttpRouter.empty.pipe(
  HttpRouter.get("/", handler)
)

// Create the HTTP server layer
const HttpLive = HttpServer.serve(router).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 }))
)

// Run the server
Effect.gen(function* () {
  yield* Effect.log("Server running on http://localhost:3000")
  return yield* Layer.launch(HttpLive)
}).pipe(NodeRuntime.runMain)
