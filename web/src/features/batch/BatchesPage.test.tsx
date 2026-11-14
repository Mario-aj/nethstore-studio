import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { BatchSummary } from '../../shared/api/schemas';
import { renderAt } from '../../test/render';
import BatchesPage from './BatchesPage';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function summary(seq: number, over: Partial<BatchSummary> = {}): BatchSummary {
  return {
    id: `b${seq}`,
    seq,
    priceKz: 10000,
    sizes: ['M', 'L'],
    description: 'Veste',
    stampLine1: 'Veste/ M e L',
    stampLine2: '10.000 kz',
    photoCount: 12,
    stampedCount: 12,
    failedCount: 0,
    finished: true,
    createdAt: new Date().toISOString(),
    coverPhotoId: `p${seq}`,
    ...over,
  };
}

describe('BatchesPage', () => {
  it('lists the batches and opens one, remembering it came from the list', async () => {
    server.use(
      http.get('*/api/batches', () =>
        HttpResponse.json({
          batches: [summary(7), summary(6, { stampLine1: 'M', stampLine2: '2.500 kz', failedCount: 1 })],
          nextBefore: null,
        }),
      ),
    );
    const user = userEvent.setup();
    renderAt(<BatchesPage />, { path: '/estudio/lotes', route: '/estudio/lotes' });

    const today = await screen.findByRole('region', { name: 'HOJE' });
    const links = within(today).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('Veste/ M e L');
    expect(links[0]).toHaveTextContent('Lote 7 · 12 fotos');
    expect(links[1]).toHaveTextContent('2.500 kz');
    expect(links[1]).toHaveTextContent('1 falhou');
    expect(screen.queryByRole('button', { name: 'Ver lotes mais antigos' })).not.toBeInTheDocument();

    await user.click(links[0] as HTMLElement);
    expect(screen.getAllByTestId('location').at(-1)).toHaveTextContent('/estudio/lotes/b7');
  });

  it('loads older batches on request', async () => {
    const asked: (string | null)[] = [];
    server.use(
      http.get('*/api/batches', ({ request }) => {
        const before = new URL(request.url).searchParams.get('before');
        asked.push(before);
        return HttpResponse.json(
          before === null
            ? { batches: [summary(30), summary(29)], nextBefore: 29 }
            : { batches: [summary(28)], nextBefore: null },
        );
      }),
    );
    const user = userEvent.setup();
    renderAt(<BatchesPage />, { path: '/estudio/lotes', route: '/estudio/lotes' });

    await user.click(await screen.findByRole('button', { name: 'Ver lotes mais antigos' }));
    expect(await screen.findByText('Lote 28 · 12 fotos')).toBeInTheDocument();
    expect(asked).toEqual([null, '29']);
    expect(screen.queryByRole('button', { name: 'Ver lotes mais antigos' })).not.toBeInTheDocument();
  });

  it('without batches, points to a new one', async () => {
    server.use(http.get('*/api/batches', () => HttpResponse.json({ batches: [], nextBefore: null })));
    renderAt(<BatchesPage />, { path: '/estudio/lotes', route: '/estudio/lotes' });
    expect(await screen.findByText('Ainda não há lotes')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Novo lote' });
    expect(links.every((link) => link.getAttribute('href') === '/estudio')).toBe(true);
  });

  it('says when the list did not load and tries again', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/batches', () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ error: { code: 'internal' } }, { status: 500 })
          : HttpResponse.json({ batches: [summary(3)], nextBefore: null });
      }),
    );
    const user = userEvent.setup();
    renderAt(<BatchesPage />, { path: '/estudio/lotes', route: '/estudio/lotes' });
    expect(await screen.findByText('Não deu para carregar os lotes.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar outra vez' }));
    expect(await screen.findByText('Lote 3 · 12 fotos')).toBeInTheDocument();
  });
});
