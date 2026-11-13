import { defineConfig, devices } from '@playwright/test';

// E2E against the full stack (`make up`): Caddy + API + Garage. Only for a dev stack:
// the setup logs in with E2E_SECRET, which `make e2e` creates by rotating the key.
const baseURL = process.env.E2E_BASE_URL ?? 'https://localhost';
// E2E_MOCK=1 runs the suite against `pnpm dev:mock`, whose fake API lives in a service worker.
export const MOCK = process.env.E2E_MOCK === '1';

export const STORAGE_STATE = 'tests/e2e/.auth/state.json';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // One worker: the API allows 5 login attempts per minute per IP, and batches
  // share one storage; running in sequence keeps the suite deterministic.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    storageState: STORAGE_STATE,
    locale: 'pt-AO',
    timezoneId: 'Africa/Luanda',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The app's service worker would hide /s3 requests from page.route();
    // pwa.spec.ts turns it back on to check the registration.
    serviceWorkers: MOCK ? 'allow' : 'block',
    // The dev stack uses Caddy's internal CA. ignoreHTTPSErrors covers pages and
    // fetches, but Chromium still refuses to register a service worker from an
    // origin with a certificate error unless this flag is set.
    launchOptions: { args: ['--ignore-certificate-errors'] },
  },
  projects: [
    {
      name: 'pixel7-390',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'tablet-834',
      use: { ...devices['Desktop Chrome'], viewport: { width: 834, height: 1112 }, hasTouch: true },
    },
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
