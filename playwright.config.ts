import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against the production build (`vite preview`) so we measure realistic performance,
 * not dev-mode overhead. The paging test asserts the full 10k+ row list is reachable within 1 minute.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  // Use the system Google Chrome (the bundled Chromium has no build for this OS).
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    // Build in `test` mode so .env.test forces the GitHub integration off (seed fixture, ungated) —
    // independent of any developer .env.local.
    command: 'npm run build -- --mode test && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
