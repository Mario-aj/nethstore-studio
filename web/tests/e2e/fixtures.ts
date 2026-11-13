import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';

const SCREENS_DIR = resolve(process.cwd(), '../artifacts/screens');

interface Fixtures {
  /** Saves a screenshot to artifacts/screens/<project>/<name>.png (SPEC 16). */
  snap: (name: string, options?: { fullPage?: boolean }) => Promise<void>;
  /** Fails on serious or critical axe violations (SPEC 15). */
  checkA11y: (label: string) => Promise<void>;
  /** Origins other than the app's that the page tried to reach (SPEC 12.8 item 14). */
  externalRequests: string[];
}

export const test = base.extend<Fixtures>({
  externalRequests: [
    async ({ page, baseURL }, use) => {
      const origin = new URL(baseURL ?? 'https://localhost').origin;
      const seen: string[] = [];
      page.on('request', (request) => {
        const url = request.url();
        if (url.startsWith('data:') || url.startsWith('blob:')) return;
        if (new URL(url).origin !== origin) seen.push(url);
      });
      await use(seen);
      expect(seen, 'requests to other domains').toEqual([]);
    },
    { auto: true },
  ],

  snap: async ({ page }, use, testInfo) => {
    await use(async (name, options) => {
      const path = screenPath(testInfo, name);
      await mkdir(dirname(path), { recursive: true });
      await page.screenshot({ path, fullPage: options?.fullPage ?? false });
    });
  },

  checkA11y: async ({ page }, use) => {
    await use(async (label) => {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const serious = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      expect(serious, `axe on ${label}`).toEqual([]);
    });
  },
});

export { expect };

function screenPath(testInfo: TestInfo, name: string) {
  return resolve(SCREENS_DIR, testInfo.project.name, `${name}.png`);
}

/** No element wider than the viewport (nothing overflows at 390 px). */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
}

/**
 * Synthetic test photos drawn in the browser (canvas -> JPEG), alternating light and
 * dark backgrounds so both stamp colours get exercised. No real store photos.
 */
export async function syntheticPhotos(page: Page, count: number) {
  const encoded = await page.evaluate(async (n) => {
    const out: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const canvas = document.createElement('canvas');
      const portrait = i % 3 !== 2;
      canvas.width = portrait ? 1200 : 1600;
      canvas.height = portrait ? 1600 : 1200;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      const dark = i % 2 === 1;
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, dark ? '#1b1a19' : '#f2ede4');
      gradient.addColorStop(1, dark ? `hsl(${(i * 37) % 360} 30% 20%)` : `hsl(${(i * 37) % 360} 45% 75%)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = dark ? '#d8b77a' : '#3a3631';
      ctx.beginPath();
      ctx.ellipse(
        canvas.width / 2,
        canvas.height * 0.55,
        canvas.width * 0.22,
        canvas.height * 0.3,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.font = '96px sans-serif';
      ctx.fillText(`Teste ${i + 1}`, canvas.width * 0.3, canvas.height * 0.92);
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.9),
      );
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      out.push(btoa(binary));
    }
    return out;
  }, count);
  return encoded.map((b64, i) => ({
    name: `teste-${String(i + 1).padStart(2, '0')}.jpg`,
    mimeType: 'image/jpeg',
    buffer: Buffer.from(b64, 'base64'),
  }));
}

/** Fills the "Fotos e preço" form: photos, sizes, price, description. */
export async function fillBatch(
  page: Page,
  photos: Awaited<ReturnType<typeof syntheticPhotos>>,
  {
    sizes = ['M', 'L'],
    price = '10000',
    description = 'Veste',
  }: { sizes?: string[]; price?: string; description?: string } = {},
) {
  await page.getByTestId('gallery-input').setInputFiles(photos);
  await page.getByRole('button', { name: /Tamanhos/ }).click();
  for (const size of sizes) await page.getByRole('button', { name: size, exact: true }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await page.getByLabel('Preço').fill(price);
  if (description) await page.getByLabel(/Descrição/).fill(description);
}
