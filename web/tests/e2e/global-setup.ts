import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';
import { MOCK, STORAGE_STATE } from '../../playwright.config';

/**
 * Logs in once through the real Entrada screen and stores the session, so the
 * suite spends a single login attempt (the API allows 5 per minute per IP).
 */
export default async function globalSetup(config: FullConfig) {
  const secret = process.env.E2E_SECRET;
  if (!secret || secret.length !== 32) {
    throw new Error('E2E_SECRET must hold the 32-character key of the stack under test (make e2e sets it).');
  }
  const baseURL = config.projects[0]?.use.baseURL ?? 'https://localhost';

  await mkdir(dirname(STORAGE_STATE), { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    serviceWorkers: MOCK ? 'allow' : 'block',
  });
  const page = await context.newPage();
  await page.goto('/entrar');
  await page.getByLabel('Chave de acesso').fill(secret);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/estudio', { timeout: 30_000 });
  await context.storageState({ path: STORAGE_STATE });
  await browser.close();
}
