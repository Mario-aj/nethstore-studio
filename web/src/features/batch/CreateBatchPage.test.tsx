import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render';
import CreateBatchPage from './CreateBatchPage';
import { uploads } from './uploads';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

const photos = (n: number) =>
  Array.from({ length: n }, (_, i) => new File(['x'], `p${i}.jpg`, { type: 'image/jpeg' }));
const processButton = () => screen.getByRole('button', { name: /Processar/ });

async function chooseSizes(user: ReturnType<typeof userEvent.setup>, sizes: string[]) {
  await user.click(screen.getByRole('button', { name: /Tamanhos/ }));
  for (const size of sizes) await user.click(screen.getByRole('button', { name: size }));
  await user.click(screen.getByRole('button', { name: 'Aplicar' }));
}

describe('CreateBatchPage', () => {
  it('starts empty with Processar fotos disabled', () => {
    renderAt(<CreateBatchPage />, { path: '/estudio' });
    expect(screen.getByText('Ainda não há fotos')).toBeInTheDocument();
    expect(processButton()).toHaveTextContent('Processar fotos');
    expect(processButton()).toBeDisabled();
    expect(screen.getByText('escolhe fotos, preço e tamanhos')).toBeInTheDocument();
  });

  it('after Apagar lote, says the batch is gone until photos are picked', async () => {
    const user = userEvent.setup();
    renderAt(<CreateBatchPage />, { path: '/estudio', state: { batchDeleted: true } });
    const notice = screen.getByText('Lote apagado.').closest('[role="status"]');
    expect(notice).toHaveTextContent('As fotos que guardaste na galeria do telemóvel continuam lá.');

    await user.upload(screen.getByTestId('gallery-input'), photos(1));
    expect(screen.queryByText('Lote apagado.')).not.toBeInTheDocument();
  });

  it('flags the missing price, formats it while typing and enables Processar', async () => {
    const user = userEvent.setup();
    renderAt(<CreateBatchPage />, { path: '/estudio' });
    await user.upload(screen.getByTestId('gallery-input'), photos(12));
    expect(screen.getByText('Escreve o preço para processar.')).toBeInTheDocument();
    expect(screen.getByText('falta o preço')).toBeInTheDocument();
    expect(processButton()).toHaveTextContent('Processar 12 fotos');
    expect(processButton()).toBeDisabled();

    await chooseSizes(user, ['M', 'L']);
    const price = screen.getByLabelText('Preço');
    await user.type(price, '10000');
    expect(price).toHaveValue('10.000');
    // "Veste" is already written in a new batch.
    expect(screen.getByLabelText(/Descrição/)).toHaveValue('Veste');
    expect(screen.getByText('5/24')).toBeInTheDocument();
    expect(screen.getByText('Veste/ M e L')).toBeInTheDocument();
    expect(screen.getByText('10.000 kz')).toBeInTheDocument();
    expect(processButton()).toBeEnabled();
  });

  it('creates the batch, hands the files to the upload manager and opens the batch', async () => {
    const start = vi.spyOn(uploads, 'start').mockImplementation(() => undefined);
    let body: unknown;
    server.use(
      http.post('*/api/batches', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { id: 'b1', seq: 7, stampLine1: 'Veste/ M e L', stampLine2: '10.000 kz', photos: [] },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderAt(<CreateBatchPage />, { path: '/estudio' });
    await user.upload(screen.getByTestId('gallery-input'), photos(3));
    await chooseSizes(user, ['L', 'M']);
    await user.type(screen.getByLabelText('Preço'), '10000');
    const description = screen.getByLabelText(/Descrição/);
    await user.clear(description);
    await user.type(description, ' Conjunto ');
    await user.click(processButton());
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(body).toEqual({ priceKz: 10000, sizes: ['M', 'L'], description: 'Conjunto', photoCount: 3 });
    expect(start.mock.calls[0]?.[1]).toHaveLength(3);
    await waitFor(() =>
      expect(screen.getAllByTestId('location').at(-1)).toHaveTextContent('/estudio/lotes/b1'),
    );
  });

  it('sends no description when the default Veste is erased', async () => {
    let body: unknown;
    vi.spyOn(uploads, 'start').mockImplementation(() => undefined);
    server.use(
      http.post('*/api/batches', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { id: 'b2', seq: 8, stampLine1: 'M', stampLine2: '2.500 kz', photos: [] },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderAt(<CreateBatchPage />, { path: '/estudio' });
    await user.upload(screen.getByTestId('gallery-input'), photos(1));
    await chooseSizes(user, ['M']);
    await user.type(screen.getByLabelText('Preço'), '2500');
    await user.clear(screen.getByLabelText(/Descrição/));
    expect(screen.getByText('0/24')).toBeInTheDocument();
    await user.click(processButton());
    await waitFor(() =>
      expect(body).toEqual({ priceKz: 2500, sizes: ['M'], description: null, photoCount: 1 }),
    );
  });

  it('shows the API error in Portuguese', async () => {
    server.use(
      http.post('*/api/batches', () =>
        HttpResponse.json({ error: { code: 'too_many_open_batches' } }, { status: 429 }),
      ),
    );
    const user = userEvent.setup();
    renderAt(<CreateBatchPage />, { path: '/estudio' });
    await user.upload(screen.getByTestId('gallery-input'), photos(1));
    await chooseSizes(user, ['M']);
    await user.type(screen.getByLabelText('Preço'), '2500');
    await user.click(processButton());
    expect(await screen.findByText(/Já tens 5 grupos com fotos por enviar/)).toBeInTheDocument();
  });

  it('removes photos in Ver todas', async () => {
    const user = userEvent.setup();
    renderAt(<CreateBatchPage />, { path: '/estudio' });
    await user.upload(screen.getByTestId('gallery-input'), photos(3));
    await user.click(screen.getByRole('button', { name: 'Ver todas' }));
    expect(screen.getByRole('heading', { name: '3 fotos no lote' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tirar foto 2 do lote' }));
    expect(screen.getByRole('heading', { name: '2 fotos no lote' })).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('keeps at most 50 photos', async () => {
    const user = userEvent.setup();
    renderAt(<CreateBatchPage />, { path: '/estudio' });
    await user.upload(screen.getByTestId('gallery-input'), photos(53));
    expect(screen.getByText('Só cabem 50 fotos por grupo. 3 ficaram de fora.')).toBeInTheDocument();
    expect(processButton()).toHaveTextContent('Processar 50 fotos');
  });
});
