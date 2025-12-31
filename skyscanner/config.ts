import { Context, Layer } from "effect"

export class SkyscannerConfig extends Context.Tag("SkyscannerConfig")<
  SkyscannerConfig,
  {
    readonly baseUrl: string
  }
>() {}

export const SkyscannerConfigLive = (baseUrl: string) =>
  Layer.succeed(SkyscannerConfig, { baseUrl })

export const SkyscannerConfigFake = SkyscannerConfigLive("http://localhost:3000")
export const SkyscannerConfigReal = SkyscannerConfigLive("https://www.flightsfinder.com")
