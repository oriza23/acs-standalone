import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  // Port frontend dikunci: 5174. Backend selalu 5001.
  // strictPort: kalau 5174 sedang dipakai, Vite berhenti dengan error (tidak pindah diam-diam ke port lain).
  server: {
    host: true,
    port: 5174,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 5174,
    strictPort: true,
  },
})
