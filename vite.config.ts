/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves a project site under /<repo>/. The deploy workflow sets BASE_PATH to that;
  // locally (dev, preview, tests) it defaults to "/". loadSeed and asset URLs use import.meta.env.BASE_URL,
  // so everything resolves under the subpath automatically.
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  test: {
    // Component/unit tests run in jsdom; Playwright e2e lives in e2e/ and is run separately.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
