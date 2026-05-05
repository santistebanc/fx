/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public origin of the Bun API (e.g. `https://api.example.com`). Empty = same origin / Vite proxy. */
  readonly VITE_API_ORIGIN?: string
  readonly VITE_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
