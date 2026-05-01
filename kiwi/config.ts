import { Context, Layer } from "effect"
import { fakeServerOrigin } from "../utils"

export class KiwiConfig extends Context.Tag("KiwiConfig")<
  KiwiConfig,
  {
    readonly baseUrl: string
  }
>() {}

export const KiwiConfigLive = (baseUrl: string) =>
  Layer.succeed(KiwiConfig, { baseUrl })

export const KiwiConfigFake = Layer.succeed(KiwiConfig, {
  get baseUrl() {
    return fakeServerOrigin()
  },
})
export const KiwiConfigReal = KiwiConfigLive("https://www.flightsfinder.com")
