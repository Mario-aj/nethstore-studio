import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Batch } from '../../shared/api/schemas';
import { renderAt } from '../../test/render';
import type { EffectivePhoto } from './processingView';
import { ReadyScreen } from './ReadyScreen';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

const server = setupServer(
  http.get('/api/photos/:id/stamped', ({ params }) => {
    const position = String(params.id).replace('p', '').padStart(3, '0');
    return new HttpResponse(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': `attachment; filename="nethstore-007-${position}.jpg"`,
      },
    });
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const share = vi.fn<(data: ShareData) => Promise<void>>();
const canShare = vi.fn<(data: ShareData) => boolean>();

function setDevice(device: 'iphone' | 'android', { webShare = true } = {}) {
  if (device === 'iphone') {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
  }
  Object.defineProperty(navigator, 'share', { configurable: true, value: webShare ? share : undefined });
  Object.defineProperty(navigator, 'canShare', {
    configurable: true,
    value: webShare ? canShare : undefined,
  });
}

beforeEach(() => {
  share.mockReset().mockResolvedValue(undefined);
  canShare.mockReset().mockReturnValue(true);
  URL.createObjectURL = vi.fn(() => 'blob:photo');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const photo = (position: number): EffectivePhoto => ({
  id: `p${position}`,
  position,
  status: 'stamped',
  failedStep: null,
  errorCode: null,
  hasLocalFile: false,
});

function batchOf(ready: EffectivePhoto[]): Batch {
  return {
    id: 'b1',
    seq: 7,
    priceKz: 10000,
    sizes: ['M', 'L'],
    description: 'Veste',
    stampLine1: 'Veste/ M e L',
    stampLine2: '10.000 kz',
    createdAt: '2026-11-13T19:00:00Z',
    steps: {
      upload: { state: 'completed' },
      prepare: { state: 'completed' },
      stamp: { state: 'completed' },
      ready: { state: 'completed' },
    },
    failedCount: 0,
    finished: true,
    photos: ready.map((p) => ({
      id: p.id,
      position: p.position,
      status: 'stamped',
      failedStep: null,
      errorCode: null,
    })),
  };
}

function renderReady(count: number, { onDeleted = () => undefined }: { onDeleted?: () => void } = {}) {
  const ready = Array.from({ length: count }, (_, i) => photo(i + 1));
  return renderAt(
    <ReadyScreen
      batch={batchOf(ready)}
      ready={ready}
      failed={[]}
      total={count}
      retrying={false}
      onRetryFailed={() => undefined}
      onNewGroup={() => undefined}
      onDeleted={onDeleted}
    />,
    { path: '/estudio/lotes/b1' },
  );
}

const sharedNames = (call: number) => (share.mock.calls[call]?.[0].files ?? []).map((f) => f.name);
const location = () => screen.getAllByTestId('location')[0]?.textContent;

describe('ReadyScreen viewer', () => {
  it('opens the tapped photo full screen and closes back to the grid', async () => {
    setDevice('android');
    const user = userEvent.setup();
    renderReady(3);

    await user.click(screen.getByRole('button', { name: 'Ver foto 2' }));
    const dialog = screen.getByRole('dialog', { name: 'Pré-visualização' });
    expect(dialog).toHaveTextContent('2 de 3');
    expect(location()).toBe('/estudio/lotes/b1?foto=2');

    await user.click(screen.getByRole('button', { name: 'Foto seguinte' }));
    expect(location()).toBe('/estudio/lotes/b1?foto=3');

    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(location()).toBe('/estudio/lotes/b1');
  });

  it('on iPhone, Guardar in the viewer sends that photo to the share sheet', async () => {
    setDevice('iphone');
    const user = userEvent.setup();
    renderReady(3);
    await user.click(screen.getByRole('button', { name: 'Ver foto 3' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(sharedNames(0)).toEqual(['nethstore-007-003.jpg']);
    expect(await screen.findByRole('button', { name: 'Guardada' })).toBeInTheDocument();
  });

  it('on Android, Guardar in the viewer downloads that photo', async () => {
    setDevice('android');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderReady(2);
    await user.click(screen.getByRole('button', { name: 'Ver foto 1' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(share).not.toHaveBeenCalled();
  });
});

describe('ReadyScreen Guardar todas', () => {
  it('on iPhone, prepares every photo and sends all of them in one share', async () => {
    setDevice('iphone');
    const user = userEvent.setup();
    renderReady(12);
    const save = await screen.findByRole('button', { name: 'Guardar todas na galeria' });
    await user.click(save);
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(sharedNames(0)).toHaveLength(12);
    expect(sharedNames(0)[0]).toBe('nethstore-007-001.jpg');
    expect(await screen.findByRole('button', { name: 'Guardadas na galeria' })).toBeInTheDocument();
  });

  it('on iPhone, when the sheet refuses all of them, goes on 10 at a time', async () => {
    setDevice('iphone');
    share.mockRejectedValueOnce(new DOMException('too many', 'NotAllowedError'));
    const user = userEvent.setup();
    renderReady(12);
    await user.click(await screen.findByRole('button', { name: 'Guardar todas na galeria' }));
    expect(await screen.findByText(/Toca outra vez para guardar de 10 em 10/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Guardar as próximas 10' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    expect(sharedNames(1)).toHaveLength(10);

    await user.click(await screen.findByRole('button', { name: 'Guardar as próximas 2' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(3));
    expect(sharedNames(2)).toEqual(['nethstore-007-011.jpg', 'nethstore-007-012.jpg']);
    expect(await screen.findByRole('button', { name: 'Guardadas na galeria' })).toBeInTheDocument();
  });

  it('on iPhone, when canShare refuses all of them, sends the first 10 in the same tap', async () => {
    setDevice('iphone');
    canShare.mockImplementation((data) => (data.files?.length ?? 0) <= 10);
    const user = userEvent.setup();
    renderReady(12);
    await user.click(await screen.findByRole('button', { name: 'Guardar todas na galeria' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(sharedNames(0)).toHaveLength(10);
    expect(await screen.findByRole('button', { name: 'Guardar as próximas 2' })).toBeInTheDocument();
  });

  it('on iPhone, a cancelled sheet changes nothing', async () => {
    setDevice('iphone');
    share.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
    const user = userEvent.setup();
    renderReady(3);
    await user.click(await screen.findByRole('button', { name: 'Guardar todas na galeria' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Guardar todas na galeria' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('on Android, downloads every photo', async () => {
    setDevice('android');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderReady(2);
    await user.click(screen.getByRole('button', { name: 'Guardar todas na galeria' }));
    expect(
      await screen.findByRole('button', { name: 'Guardadas na galeria' }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(click).toHaveBeenCalledTimes(2);
    expect(share).not.toHaveBeenCalled();
  });
});

describe('ReadyScreen Apagar lote', () => {
  /** DELETE /api/batches/:id answering `status` (with an error body when it is not 204). */
  function deleteEndpoint(status: number, code = 'internal') {
    const calls: string[] = [];
    server.use(
      http.delete('/api/batches/:id', ({ params }) => {
        calls.push(String(params.id));
        return status === 204
          ? new HttpResponse(null, { status })
          : HttpResponse.json({ error: { code } }, { status });
      }),
    );
    return calls;
  }

  it('asks first, then deletes the batch on the server', async () => {
    setDevice('android');
    const calls = deleteEndpoint(204);
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    renderReady(3, { onDeleted });

    await user.click(screen.getByRole('button', { name: 'Apagar lote' }));
    const sheet = screen.getByRole('dialog', { name: 'Apagar este lote?' });
    expect(sheet).toHaveTextContent('As 3 fotos deste lote saem do Estúdio');
    expect(sheet).toHaveTextContent('As que já guardaste na galeria do telemóvel continuam lá.');
    expect(calls).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(['b1']);
  });

  it('Cancelar keeps the batch', async () => {
    setDevice('android');
    const calls = deleteEndpoint(204);
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    renderReady(2, { onDeleted });

    await user.click(screen.getByRole('button', { name: 'Apagar lote' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls).toEqual([]);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('a failed delete says so and keeps the sheet open', async () => {
    setDevice('android');
    deleteEndpoint(500);
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    renderReady(2, { onDeleted });

    await user.click(screen.getByRole('button', { name: 'Apagar lote' }));
    await user.click(screen.getByRole('button', { name: 'Apagar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não deu para apagar o lote.');
    expect(screen.getByRole('dialog', { name: 'Apagar este lote?' })).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('a batch that is already gone counts as deleted', async () => {
    setDevice('android');
    deleteEndpoint(404, 'not_found');
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    renderReady(1, { onDeleted });

    await user.click(screen.getByRole('button', { name: 'Apagar lote' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('A foto deste lote sai do Estúdio');
    await user.click(screen.getByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });
});
