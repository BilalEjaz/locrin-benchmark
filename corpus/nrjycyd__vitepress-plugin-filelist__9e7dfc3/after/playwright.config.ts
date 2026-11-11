import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests against the fixture site in `demo/e2e` and a mock OpenList.
 * Build the site first: `pnpm run e2e:site` (CI does the same steps).
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    // Touch + narrow container: 56px rows, phone ZIP limits, bottom-sheet dialogs.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    // Safari's engine: no file streaming, so ZIPs are built in memory.
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      command: 'node e2e/mock-openlist.mjs',
      url: 'http://localhost:5299/api/public/settings',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --dir demo run preview:e2e',
      url: 'http://localhost:4173/',
      reuseExistingServer: !process.env.CI,
    },
  ],
})
