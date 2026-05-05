/**
 * Captures docs/screenshots/app.png using the bundled fixture (?fixture=1).
 * Viewport: iPad-sized (Playwright device preset, landscape for the wide search bar).
 * Requires: bun run web:build, playwright browsers (bunx playwright install chromium).
 */
import { chromium, devices, type Browser, type BrowserContext } from "playwright"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outPath = join(root, "docs/screenshots/app.png")
const port = 30991

const build = Bun.spawn(["bun", "run", "web:build"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
})
const buildCode = await build.exited
if (buildCode !== 0) process.exit(buildCode ?? 1)

const server = Bun.spawn(["bun", join(root, "web/server.ts")], {
  cwd: root,
  env: { ...process.env, PORT: String(port), WEB_PORT: String(port) },
  stdout: "inherit",
  stderr: "inherit",
})

let browser: Browser | undefined
let context: BrowserContext | undefined

try {
  await new Promise((r) => setTimeout(r, 2000))
  browser = await chromium.launch({ headless: true })
  context = await browser.newContext({
    ...devices["iPad Air landscape"],
  })
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${port}/?fixture=1`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  })
  await page.getByText("Trip 1 of").waitFor({ state: "visible", timeout: 90_000 })
  await page.screenshot({ path: outPath, fullPage: true })
  console.log("[captureReadmeScreenshot] wrote", outPath)
} finally {
  await context?.close()
  await browser?.close()
  server.kill()
  await server.exited
}
