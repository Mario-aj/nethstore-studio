import { describe, expect, it } from 'vitest';
import type { Batch, BatchPhoto, PhotoStatus } from '../../shared/api/schemas';
import { computeSteps, effectivePhotos, processingView } from './processingView';
import type { BatchUploadView } from './uploadManager';

type Spec = [PhotoStatus, BatchPhoto['failedStep']?];

function batchOf(specs: Spec[]): Batch {
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
      upload: { state: 'pending' },
      prepare: { state: 'pending' },
      stamp: { state: 'pending' },
      ready: { state: 'pending' },
    },
    failedCount: 0,
    finished: false,
    photos: specs.map(([status, failedStep = null], i) => ({
      id: `p${i + 1}`,
      position: i + 1,
      status,
      failedStep,
      errorCode: failedStep ? 'processing_failed' : null,
    })),
  };
}

const many = (n: number, spec: Spec): Spec[] => Array.from({ length: n }, () => spec);
const statesOf = (specs: Spec[]) => {
  const steps = computeSteps(effectivePhotos(batchOf(specs), undefined));
  return [steps.upload.state, steps.prepare.state, steps.stamp.state, steps.ready.state];
};

describe('computeSteps (SPEC 7.3)', () => {
  it('fresh batch: upload loading, the rest pending', () => {
    expect(statesOf(many(12, ['awaiting_upload']))).toEqual(['loading', 'pending', 'pending', 'pending']);
  });

  it('upload in progress with some photos ahead', () => {
    const specs = [...many(3, ['uploaded']), ...many(9, ['awaiting_upload'])];
    const steps = computeSteps(effectivePhotos(batchOf(specs), undefined));
    expect(steps.upload).toMatchObject({ state: 'loading', done: 3, total: 12 });
    expect(steps.prepare).toMatchObject({ state: 'loading', done: 0 });
    expect(steps.stamp.state).toBe('pending');
  });

  it('design "A aplicar": 7 stamped, 4 in stamp, 1 failed in stamp', () => {
    const specs = [...many(7, ['stamped']), ['failed', 'stamp'] as Spec, ...many(4, ['prepared'])];
    const steps = computeSteps(effectivePhotos(batchOf(specs), undefined));
    expect(steps.upload).toMatchObject({ state: 'completed', done: 12 });
    expect(steps.prepare).toMatchObject({ state: 'completed', done: 12 });
    expect(steps.stamp).toMatchObject({ state: 'loading', done: 7, failed: 1 });
    expect(steps.ready.state).toBe('pending');
  });

  it('a failure in an earlier step counts as completed for the later steps', () => {
    const specs = [['failed', 'upload'] as Spec, ...many(11, ['stamped'])];
    const steps = computeSteps(effectivePhotos(batchOf(specs), undefined));
    expect(steps.upload).toMatchObject({ state: 'error', done: 11, failed: 1 });
    expect(steps.prepare).toMatchObject({ state: 'completed', done: 11 });
    expect(steps.stamp).toMatchObject({ state: 'completed', done: 11 });
    expect(steps.ready).toMatchObject({ state: 'completed', done: 11 });
  });

  it('error when the step ended with failures', () => {
    const specs = [...many(11, ['stamped']), ['failed', 'stamp'] as Spec];
    expect(statesOf(specs)).toEqual(['completed', 'completed', 'error', 'completed']);
  });

  it('ready is error when nothing got stamped', () => {
    expect(statesOf(many(3, ['failed', 'prepare']))).toEqual(['completed', 'error', 'completed', 'error']);
  });
});

describe('effectivePhotos', () => {
  const uploads = (items: BatchUploadView['items']): BatchUploadView => ({
    batchId: 'b1',
    items,
    active: true,
    doneCount: 0,
    failedCount: 0,
  });

  it('trusts the upload manager ahead of the next poll', () => {
    const batch = batchOf([['awaiting_upload'], ['awaiting_upload'], ['failed', 'upload']]);
    const photos = effectivePhotos(
      batch,
      uploads([
        { photoId: 'p1', position: 1, state: 'done', progress: 1, attempts: 0, hasFile: false },
        { photoId: 'p2', position: 2, state: 'failed', progress: 0, attempts: 3, hasFile: true },
        { photoId: 'p3', position: 3, state: 'working', progress: 0.5, attempts: 0, hasFile: true },
      ]),
    );
    expect(photos.map((p) => p.status)).toEqual(['uploaded', 'failed', 'awaiting_upload']);
    expect(photos[1]).toMatchObject({ failedStep: 'upload', hasLocalFile: true });
  });
});

describe('processingView', () => {
  const view = (specs: Spec[], extra: Partial<Parameters<typeof processingView>[0]> = {}) =>
    processingView({
      batch: batchOf(specs),
      uploads: undefined,
      paused: false,
      mode: 'lan',
      accepted: false,
      ...extra,
    });

  it('uploading: warn message and upload counter', () => {
    const v = view([...many(3, ['uploaded']), ...many(9, ['awaiting_upload'])]);
    expect(v.phase).toBe('uploading');
    expect(v.title).toBe('A enviar as fotos');
    expect(v.caption).toBe('3 de 12 fotos');
    expect(v.pct).toBe(25);
    expect(v.message).toEqual({ tone: 'warn', text: 'Não feches o app enquanto as fotos sobem.' });
  });

  it('offline: grey ring, "Em pausa" and upload step in error', () => {
    const v = view([...many(3, ['uploaded']), ...many(9, ['awaiting_upload'])], { paused: true });
    expect(v.phase).toBe('offline');
    expect(v.ringPaused).toBe(true);
    expect(v.caption).toBe('Em pausa');
    expect(v.title).toBe('Sem ligação');
    expect(v.steps[0]).toMatchObject({ state: 'error', count: '3/12 · em pausa' });
  });

  it('stamping: calm message, stamped counter', () => {
    const v = view([...many(7, ['stamped']), ['failed', 'stamp'], ...many(4, ['prepared'])]);
    expect(v.phase).toBe('stamping');
    expect(v.title).toBe('A aplicar o carimbo');
    expect(v.caption).toBe('7 de 12 fotos');
    expect(Math.round(v.pct)).toBe(58);
    expect(v.message?.text).toBe('Podes bloquear o telemóvel. O computador continua.');
    expect(v.steps[2]).toMatchObject({ state: 'loading', count: '7/12' });
    expect(v.failed).toHaveLength(1);
  });

  it('preparing before anything reaches the stamp step', () => {
    expect(view(many(4, ['uploaded'])).phase).toBe('preparing');
  });

  it('design "Uma foto falhou": failed phase until the user decides', () => {
    const specs: Spec[] = [...many(11, ['stamped']), ['failed', 'stamp']];
    const v = view(specs);
    expect(v.phase).toBe('failed');
    expect(v.title).toBe('Uma foto falhou');
    expect(v.message?.text).toBe('As outras 11 estão prontas.');
    expect(v.steps[2]).toMatchObject({ state: 'error', count: '11/12 · 1 falhou' });
    expect(v.steps[3]).toMatchObject({ state: 'pending', count: '0/12' });
    expect(view(specs, { accepted: true }).phase).toBe('done');
  });

  it('done when everything is stamped', () => {
    const v = view(many(12, ['stamped']));
    expect(v.phase).toBe('done');
    expect(v.ready).toHaveLength(12);
    expect(v.steps[3]).toMatchObject({ state: 'completed', count: '12/12' });
  });

  it('public mode uses the neutral copy', () => {
    const v = view([...many(2, ['stamped']), ...many(2, ['prepared'])], { mode: 'public' });
    expect(v.message?.text).toBe('Podes bloquear o telemóvel. O servidor continua.');
  });
});
