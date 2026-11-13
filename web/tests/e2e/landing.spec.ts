import { expect, expectNoHorizontalOverflow, test } from './fixtures';

test.describe('landing', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('renders every section at this width', async ({ page, snap, checkA11y }, testInfo) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Do fardo à montra em minutos.');
    for (const name of [
      'Três passos. Nenhuma edição à mão.',
      'O carimbo de sempre, sem o trabalho de sempre.',
      'Fica no ecrã do telemóvel, como uma app.',
      'Pronta para o próximo fardo?',
    ]) {
      await expect(page.getByRole('heading', { name })).toBeVisible();
    }
    await expect(page.getByText(/O endereço .*localhost|O endereço .*\d+\.\d+/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.evaluate(() => document.fonts.ready);
    await snap('landing', { fullPage: true });
    await checkA11y('landing');

    const desktop = testInfo.project.name.startsWith('desktop');
    const howLink = page
      .getByRole('navigation', { name: 'Principal' })
      .getByRole('link', { name: 'Como funciona' });
    if (desktop) {
      await expect(howLink).toBeVisible();
    } else {
      await expect(howLink).toBeHidden();
      await page.getByRole('button', { name: 'Abrir menu' }).click();
      await expect(howLink).toBeVisible();
      await snap('landing-menu');
      await page.keyboard.press('Escape');
      await expect(howLink).toBeHidden();
    }
  });

  test('the comparator moves with the keyboard', async ({ page }) => {
    await page.goto('/#carimbo');
    const slider = page.getByRole('slider', { name: /divisória/ });
    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(slider).toHaveValue('49');
  });

  test('Entrar leads to the login', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    await expect(page.getByRole('heading', { name: 'Bem-vinda.' })).toBeVisible();
  });

  test('unknown paths show the not found page', async ({ page, checkA11y }) => {
    await page.goto('/nao-existe');
    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
    await checkA11y('404');
  });
});
