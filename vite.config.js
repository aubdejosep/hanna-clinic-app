import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Each build gets a version (its build time). The app knows its own (__APP_VERSION__) and the build writes the same
// value to /version.json, which the open app checks: a different one means a new version is live, and staff are asked
// to reload (components/UpdateNotice.jsx).
const VERSION = new Date().toISOString()
const versionFile = { name: 'version-file', apply: 'build', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: VERSION }) }) } }

// `npm run dev` serves the screens on :5173 and sends /api to the Pages Functions
// running under `npm run dev:api` (:8788), so both can reload independently.
export default defineConfig({
  plugins: [react(), versionFile],
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  server: { proxy: { '/api': 'http://localhost:8788' } },
})
