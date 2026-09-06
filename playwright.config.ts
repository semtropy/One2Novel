import { defineConfig } from '@playwright/test';
// Some Windows IDE shells omit System32; Playwright needs taskkill for fixture-server cleanup.
if (process.platform === 'win32')
  process.env.PATH = `${process.env.SystemRoot || 'C:\\Windows'}\\System32;${process.env.PATH || ''}`;
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 20000 },
  use: {
    baseURL: 'http://127.0.0.1:7466',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: true,
  },
  webServer: {
    command: 'pnpm exec tsx tests/e2e/server.ts',
    url: 'http://127.0.0.1:7466/api/v1/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
