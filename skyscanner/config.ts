import { Context, Layer } from "effect"
import { fakeServerOrigin } from "../utils"

export class SkyscannerConfig extends Context.Tag("SkyscannerConfig")<
  SkyscannerConfig,
  {
    readonly baseUrl: string
  }
>() {}

export const SkyscannerConfigLive = (baseUrl: string) =>
  Layer.succeed(SkyscannerConfig, { baseUrl })

export const SkyscannerConfigFake = Layer.succeed(SkyscannerConfig, {
  get baseUrl() {
    return fakeServerOrigin()
  },
})
export const SkyscannerConfigReal = SkyscannerConfigLive("https://www.flightsfinder.com")
