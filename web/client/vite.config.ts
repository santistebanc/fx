import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  /** GitHub project sites use `/repo-name/`; leave default `/` for dev or root hosting. */
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), tailwindcss()],
  root: __dirname,
  /** Styles are imported from `../../public/styles.css` in `src/index.css`; avoid duplicating `outDir` into `public/`. */
  publicDir: false,
  resolve: {
    alias: {
      "@fx": path.resolve(__dirname, "../.."),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3010",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../public/dist"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
    },
  },
})
