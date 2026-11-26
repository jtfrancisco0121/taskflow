import { defineConfig, devices } from '@playwright/test'

// FR-26: the Phase 1 flows run against the real backend through the Vite /api proxy.
// Start the infrastructure and the backend first (see README); Vite is started here.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // The JSON report lets scripts/e2e-local.sh keep the trace and screenshot of every failed attempt, also of
  // a test that passed on a retry (Playwright empties test-results/ at the start of each run).
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never' }],
        ['json', { outputFile: '../artifacts/e2e-results.json' }],
      ]
    : [['list'], ['json', { outputFile: '../artifacts/e2e-results.json' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
