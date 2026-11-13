import type { Page } from '@playwright/test';
import { MOCK } from '../../playwright.config';
import { expect, expectNoHorizontalOverflow, fillBatch, syntheticPhotos, test } from './fixtures';

async function waitForReady(page: Page) {
  // exact: the processing screen also has a "JÁ PRONTAS · N" heading.
  await expect(page.getByRole('heading', { name: 'Prontas', exact: true })).toBeVisible({ timeout: 90_000 });
}

test.describe('lote', () => {
  test('create a batch, follow it to the end and open the final grid', async ({
    page,
    snap,
    checkA11y,
  }, testInfo) => {
    const full = testInfo.project.name === 'pixel7-390';
    const count = full ? 12 : 3;
    await page.goto('/estudio');
    await expect(page.getByRole('heading', { name: 'Fotos e preço' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Processar fotos' })).toBeDisabled();
    await snap('fotos-vazio');
    await checkA11y('fotos e preço vazio');

    const photos = await syntheticPhotos(page, count);
    await page.getByTestId('gallery-input').setInputFiles(photos);
    await expect(page.getByText('Escreve o preço para processar.')).toBeVisible();
    await snap('fotos-preco-em-falta');

    await page.getByRole('button', { name: /Tamanhos/ }).click();
    await page.getByRole('button', { name: 'M', exact: true }).click();
    await page.getByRole('button', { name: 'L', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Tamanhos' })).toBeVisible();
    await snap('fotos-folha-tamanhos');
    await checkA11y('folha de tamanhos');
    await page.getByRole('button', { name: 'Aplicar' }).click();

    await page.getByLabel('Preço').fill('10000');
    await expect(page.getByLabel('Preço')).toHaveValue('10.000');
    await page.getByLabel(/Descrição/).fill('Veste');
    await expect(page.getByText('Veste/ M e L')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await snap('fotos-pronto-a-processar');
    await checkA11y('fotos e preço pronto');

    await page.getByRole('button', { name: 'Ver todas' }).click();
    await expect(page.getByRole('heading', { name: `${count} fotos no lote` })).toBeVisible();
    await snap('fotos-ver-todas');
    await checkA11y('ver todas');
    await page.getByRole('button', { name: 'Concluir' }).click();

    await page.getByRole('button', { name: `Processar ${count} fotos` }).click();
    await expect(page).toHaveURL(/\/estudio\/lotes\/[\w-]+$/);
    await expect(page.getByRole('progressbar', { name: 'Progresso do lote' })).toBeVisible();
    await snap('processamento');
    await checkA11y('processamento');

    await waitForReady(page);
    await expect(page.getByText(`de ${count} fotos carimbadas`)).toBeVisible();
    const grid = page.getByRole('list', { name: 'Fotos carimbadas' });
    await expect(grid.getByRole('img')).toHaveCount(count);
    // Every thumbnail actually loaded.
    await expect
      .poll(() =>
        grid
          .getByRole('img')
          .evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0)),
      )
      .toBe(true);
    await expectNoHorizontalOverflow(page);
    await snap('pronto');
    await checkA11y('pronto');

    if (full && !MOCK) {
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Guardar todas na galeria' }).click();
      expect((await download).suggestedFilename()).toMatch(/^nethstore-\d{3}-001\.jpg$/);
      await expect(page.getByRole('button', { name: 'Guardadas na galeria' })).toBeVisible({
        timeout: 30_000,
      });
    }

    await page.getByRole('button', { name: 'Novo grupo' }).click();
    await expect(page).toHaveURL(/\/estudio$/);
    await expect(page.getByText('Ainda não há fotos')).toBeVisible();
  });

  test('a failed upload is repeated with Repetir', async ({ page, snap, checkA11y }, testInfo) => {
    test.skip(testInfo.project.name !== 'pixel7-390', 'full flow runs at 390 px');
    test.skip(MOCK, 'page.route cannot see requests handled by the mock service worker');

    // The first photo's upload is refused 3 times by the "storage"; then it goes through.
    let target: string | null = null;
    let refused = 0;
    await page.route('**/s3/estudio', async (route) => {
      const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
      const key = /originals\/[\w-]+\/[\w-]+\.jpg/.exec(body)?.[0] ?? '';
      target ??= key;
      if (key === target && refused < 3) {
        refused += 1;
        await route.fulfill({
          status: 403,
          contentType: 'application/xml',
          body: '<Error><Code>AccessDenied</Code></Error>',
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/estudio');
    await fillBatch(page, await syntheticPhotos(page, 4));
    await page.getByRole('button', { name: 'Processar 4 fotos' }).click();

    await expect(page.getByRole('heading', { name: 'Uma foto falhou' })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('As outras 3 estão prontas.')).toBeVisible();
    await expect(page.getByText(/1 falhou/).first()).toBeVisible();
    expect(refused).toBe(3);
    await snap('processamento-erro');
    await checkA11y('processamento com erro');

    await page.getByRole('button', { name: /Repetir 1 foto/ }).click();
    await waitForReady(page);
    await expect(page.getByText('de 4 fotos carimbadas')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Fotos carimbadas' }).getByRole('img')).toHaveCount(4);
  });

  test('continue with the photos that worked', async ({ page, snap }, testInfo) => {
    test.skip(testInfo.project.name !== 'pixel7-390', 'full flow runs at 390 px');
    test.skip(MOCK, 'page.route cannot see requests handled by the mock service worker');

    // Refuse every upload of photo 3; its key comes from the batch creation response.
    let lastKey = '';
    page.on('response', async (response) => {
      if (response.url().endsWith('/api/batches') && response.request().method() === 'POST') {
        const json = (await response.json()) as {
          photos: { position: number; upload: { fields: Record<string, string> } }[];
        };
        lastKey = json.photos.find((p) => p.position === 3)?.upload.fields.key ?? '';
      }
    });
    await page.route('**/s3/estudio', async (route) => {
      const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
      const key = /originals\/[\w-]+\/[\w-]+\.jpg/.exec(body)?.[0] ?? '';
      if (lastKey && key === lastKey) return route.fulfill({ status: 403, body: 'denied' });
      return route.continue();
    });

    await page.goto('/estudio');
    await fillBatch(page, await syntheticPhotos(page, 3), { sizes: ['S'], price: '2500', description: '' });
    await page.getByRole('button', { name: 'Processar 3 fotos' }).click();
    await expect(page.getByRole('button', { name: 'Seguir com 2' })).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Seguir com 2' }).click();
    await waitForReady(page);
    await expect(page.getByRole('region', { name: 'Fotos com erro' })).toContainText('1 foto falhou');
    await expect(page.getByRole('region', { name: 'Fotos com erro' })).toContainText(
      'Foto 3 · a foto não foi enviada',
    );
    await snap('pronto-com-falha');
  });
});
