import { Context, Layer } from "effect"

export class KiwiConfig extends Context.Tag("KiwiConfig")<
  KiwiConfig,
  {
    readonly baseUrl: string
  }
>() {}

export const KiwiConfigLive = (baseUrl: string) =>
  Layer.succeed(KiwiConfig, { baseUrl })

export const KiwiConfigFake = KiwiConfigLive("http://localhost:3000")
export const KiwiConfigReal = KiwiConfigLive("https://www.flightsfinder.com")
