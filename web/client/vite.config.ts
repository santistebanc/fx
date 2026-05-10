import path from "node:path"
import { copyFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  /** GitHub project sites use `/repo-name/`; leave default `/` for dev or root hosting. */
  base: process.env.VITE_BASE ?? "/",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "github-pages-spa-fallback",
      closeBundle() {
        const distDir = path.resolve(__dirname, "../public/dist")
        copyFileSync(path.join(distDir, "index.html"), path.join(distDir, "404.html"))
      },
    },
  ],
  root: __dirname,
  publicDir: path.resolve(__dirname, "public"),
  resolve: {
    alias: {
      "@flyscan": path.resolve(__dirname, "../.."),
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
