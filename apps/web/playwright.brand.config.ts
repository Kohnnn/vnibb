import { defineConfig, devices } from '@playwright/test';

// Brand acceptance (#196) across engines. `PW_BASE_URL` lets this run against an
// already-running dev server; the default documents the isolated :3101 server.
export default defineConfig({
  testDir: './e2e',
  // Moving the brand suites here must not lose the default config's guard: a
  // stray `.only` would otherwise make three engine jobs quietly pass.
  forbidOnly: !!process.env.CI,
  testMatch: ['**/brand.spec.ts', '**/brand-states.spec.ts'],
  fullyParallel: false,
  reporter: 'line',
  use: { baseURL: process.env.PW_BASE_URL || 'http://127.0.0.1:3101', trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
