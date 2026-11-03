import { defineConfig, devices } from '@playwright/test';

// Scoped to fonts.spec.ts: the only spec that loads the dev-only /zz-font-fixture
// route. Runs across engines for the #195 token/fallback contract.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/fonts.spec.ts'],
  fullyParallel: false,
  reporter: 'line',
  use: { baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://127.0.0.1:3001', trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
