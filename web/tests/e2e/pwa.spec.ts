import { MOCK } from '../../playwright.config';
import { expect, test } from './fixtures';

test.describe('PWA, SEO e cabeçalhos', () => {
  test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'allow' });

  test('manifest is valid for installation', async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'once is enough');
    test.skip(MOCK, 'the manifest only exists in the production build');
    const response = await request.get('/manifest.webmanifest');
    expect(response.ok()).toBe(true);
    const manifest = (await response.json()) as Record<string, unknown> & {
      icons: { sizes: string; purpose: string }[];
    };
    expect(manifest).toMatchObject({
      name: 'NethStore Estúdio',
      short_name: 'Estúdio',
      start_url: '/estudio',
      scope: '/',
      display: 'standalone',
      background_color: '#0E0D0C',
      theme_color: '#0E0D0C',
    });
    for (const size of ['192x192', '512x512']) {
      expect(manifest.icons.some((i) => i.sizes === size && i.purpose === 'any')).toBe(true);
      expect(manifest.icons.some((i) => i.sizes === size && i.purpose === 'maskable')).toBe(true);
    }
    for (const icon of manifest.icons as unknown as { src: string }[]) {
      expect((await request.get(icon.src)).ok()).toBe(true);
    }
  });

  test('registers the service worker and never caches the API', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'once is enough');
    test.skip(MOCK, 'the app service worker only exists in the production build');
    await page.goto('/');
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(new URL(scope).pathname).toBe('/');
    const sw = await (await page.request.get('/sw.js')).text();
    expect(sw).toContain('/^\\/api\\//');
    expect(sw).not.toMatch(/registerRoute\([^)]*api/);
  });

  test('robots, sitemap and indexing headers', async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'once is enough');
    test.skip(MOCK, 'only the production build and Caddy serve these');
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain('Disallow: /s3/');
    expect(robots).toMatch(/Sitemap: https:\/\/.+\/sitemap\.xml/);
    expect(await (await request.get('/sitemap.xml')).text()).toContain('<loc>');
    const landing = await request.get('/');
    expect(landing.headers()['x-robots-tag']).toBeUndefined();
    const login = await request.get('/entrar');
    expect(login.headers()['x-robots-tag']).toContain('noindex');
  });

  test('security headers on the HTML (SPEC 12.8 item 13)', async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'once is enough');
    test.skip(MOCK, 'headers come from Caddy');
    const headers = (await request.get('/')).headers();
    expect(headers['content-security-policy']).toContain("script-src 'self'");
    expect(headers['content-security-policy']).not.toContain('unsafe-inline');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  });

  test('no CSP violations while using the app', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
    });
    await page.goto('/');
    await page.goto('/entrar');
    await expect(page.getByRole('heading', { name: 'Bem-vinda.' })).toBeVisible();
    expect(violations).toEqual([]);
  });
});
