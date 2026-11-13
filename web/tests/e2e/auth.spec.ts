import { expect, test } from './fixtures';

const SECRET = process.env.E2E_SECRET ?? '';

test.describe('entrada', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('protected routes send to /entrar with next', async ({ page }) => {
    await page.goto('/estudio');
    await expect(page).toHaveURL(/\/entrar\?next=%2Festudio$/);
  });

  test('wrong key, then the right key', async ({ page, snap, checkA11y }, testInfo) => {
    // Two login attempts: only one project runs it (5 attempts per minute per IP).
    test.skip(testInfo.project.name !== 'pixel7-390', 'login attempts are rate limited');
    await page.goto('/entrar?next=%2Festudio');
    await expect(page.getByText('Ligado')).toBeVisible();
    await snap('entrada-vazio');
    await checkA11y('entrada');

    const field = page.getByLabel('Chave de acesso');
    await field.fill(SECRET.slice(0, 18));
    await expect(page.getByText('Faltam 14 caracteres.')).toBeVisible();
    await snap('entrada-a-escrever');

    await field.fill(SECRET.slice(0, 26));
    await page.getByRole('heading', { name: 'Bem-vinda.' }).click();
    await expect(page.getByText('A chave tem 32 caracteres. Esta tem 26.')).toBeVisible();
    await snap('entrada-incompleta');

    const wrong = [...SECRET].reverse().join('') === SECRET ? 'Z'.repeat(32) : [...SECRET].reverse().join('');
    await field.fill(wrong);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByText(/^Chave errada\./)).toBeVisible();
    await snap('entrada-chave-errada');
    await checkA11y('entrada com erro');

    await field.fill(SECRET);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/estudio$/);
    await expect(page.getByRole('heading', { name: 'Fotos e preço' })).toBeVisible();

    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    await page.goto('/estudio');
    await expect(page).toHaveURL(/\/entrar\?next=/);
  });
});
