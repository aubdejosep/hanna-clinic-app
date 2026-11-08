import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev` serves the screens on :5173 and sends /api to the Pages Functions
// running under `npm run dev:api` (:8788), so both can reload independently.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8788' } },
})
