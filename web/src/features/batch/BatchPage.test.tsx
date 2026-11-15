import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes, type InitialEntry } from 'react-router';
import { queryKeys } from '../../shared/api/endpoints';
import type { Batch, BatchPage as BatchListPage, BatchSummary } from '../../shared/api/schemas';
import { LocationProbe } from '../../test/render';
import BatchPage from './BatchPage';

const batch: Batch = {
  id: 'b1',
  seq: 7,
  priceKz: 10000,
  sizes: ['M', 'L'],
  description: 'Veste',
  stampLine1: 'Veste/ M e L',
  stampLine2: '10.000 kz',
  createdAt: '2026-11-14T10:00:00Z',
  photoCount: 2,
  steps: {
    upload: { state: 'completed', done: 2, total: 2 },
    prepare: { state: 'completed', done: 2, total: 2 },
    stamp: { state: 'completed', done: 2, total: 2 },
    ready: { state: 'completed' },
  },
  failedCount: 0,
  finished: true,
  photos: [1, 2].map((position) => ({
    id: `p${position}`,
    position,
    status: 'stamped' as const,
    failedStep: null,
    errorCode: null,
  })),
};

let deleted = false;
const server = setupServer(
  http.get('*/api/config', () => HttpResponse.json({ deployMode: 'lan' })),
  http.get('*/api/batches/b1', () => HttpResponse.json(batch)),
  http.delete('*/api/batches/b1', () => {
    deleted = true;
    return new HttpResponse(null, { status: 204 });
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  deleted = false;
});
afterAll(() => server.close());

function renderBatch(entries: InitialEntry[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Routes>
          <Route path="/estudio/lotes/:id" element={<BatchPage />} />
          <Route path="*" element={null} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

// The hash marks the list's own history entry: going back lands on it, a new push would not.
const fromList: InitialEntry[] = [
  '/estudio/lotes#lista',
  { pathname: '/estudio/lotes/b1', state: { fromList: true } },
];
const fromCreate: InitialEntry[] = ['/estudio', '/estudio/lotes/b1'];
const location = () => screen.getByTestId('location');

describe('BatchPage, way back to Lotes', () => {
  it('opened from Lotes, the back arrow returns to the list entry', async () => {
    const user = userEvent.setup();
    renderBatch(fromList);
    await screen.findByRole('heading', { name: 'Prontas' });
    await user.click(screen.getByRole('button', { name: 'Voltar aos lotes' }));
    await waitFor(() => expect(location()).toHaveTextContent(/^\/estudio\/lotes#lista$/));
  });

  it('after Processar, the back arrow opens Lotes instead of going back to the form', async () => {
    const user = userEvent.setup();
    renderBatch(fromCreate);
    await screen.findByRole('heading', { name: 'Prontas' });
    await user.click(screen.getByRole('button', { name: 'Voltar aos lotes' }));
    await waitFor(() => expect(location()).toHaveTextContent(/^\/estudio\/lotes$/));
  });

  it('Apagar lote from Lotes goes back to a list that no longer has the batch', async () => {
    const user = userEvent.setup();
    const queryClient = renderBatch(fromList);
    const summary = (id: string, seq: number) => ({ id, seq }) as BatchSummary;
    queryClient.setQueryData<InfiniteData<BatchListPage>>(queryKeys.batches, {
      pageParams: [0],
      pages: [{ batches: [summary('b2', 8), summary('b1', 7)], nextBefore: null }],
    });

    await screen.findByRole('heading', { name: 'Prontas' });
    await user.click(screen.getByRole('button', { name: 'Apagar lote' }));
    await user.click(screen.getByRole('button', { name: 'Apagar' }));

    await waitFor(() => expect(location()).toHaveTextContent(/^\/estudio\/lotes#lista$/));
    expect(deleted).toBe(true);
    const list = queryClient.getQueryData<InfiniteData<BatchListPage>>(queryKeys.batches);
    expect(list?.pages[0]?.batches.map((b) => b.id)).toEqual(['b2']);
  });

  it('Apagar lote after Processar still goes to a new batch', async () => {
    const user = userEvent.setup();
    renderBatch(fromCreate);
    await screen.findByRole('heading', { name: 'Prontas' });
    await user.click(screen.getByRole('button', { name: 'Apagar lote' }));
    await user.click(screen.getByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(location()).toHaveTextContent(/^\/estudio$/));
  });
});
