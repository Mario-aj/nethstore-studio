import { describe, expect, it } from 'vitest';
import type { BatchPage, BatchSummary } from '../../shared/api/schemas';
import { anyInProgress, groupByDay, withoutBatch } from './batchesView';

function summary(over: Partial<BatchSummary> & { seq: number; createdAt: string }): BatchSummary {
  return {
    id: `b${over.seq}`,
    priceKz: 10000,
    sizes: ['M', 'L'],
    description: 'Veste',
    stampLine1: 'Veste/ M e L',
    stampLine2: '10.000 kz',
    photoCount: 12,
    stampedCount: 12,
    failedCount: 0,
    finished: true,
    coverPhotoId: `p${over.seq}`,
    ...over,
  };
}

// Local dates, so the test does not depend on the machine's time zone.
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 30).toISOString();
const now = new Date(2026, 10, 14, 21, 0);

describe('groupByDay', () => {
  it('groups newest first under HOJE, ONTEM and the date', () => {
    const groups = groupByDay(
      [
        summary({ seq: 9, createdAt: at(14, 20) }),
        summary({ seq: 8, createdAt: at(14, 9) }),
        summary({ seq: 7, createdAt: at(13, 23) }),
        summary({ seq: 6, createdAt: at(11, 10) }),
        summary({ seq: 5, createdAt: at(11, 8) }),
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.seq)])).toEqual([
      ['HOJE', [9, 8]],
      ['ONTEM', [7]],
      ['11 NOV', [6, 5]],
    ]);
  });

  it('knows yesterday across a month boundary', () => {
    const groups = groupByDay(
      [summary({ seq: 1, createdAt: new Date(2026, 10, 30, 12).toISOString() })],
      new Date(2026, 11, 1, 8),
    );
    expect(groups[0]?.label).toBe('ONTEM');
  });

  it('describes each row: stamp, price, batch number, photos and what needs attention', () => {
    const [group] = groupByDay(
      [
        summary({ seq: 4, createdAt: at(14, 12) }),
        summary({ seq: 3, createdAt: at(14, 11), stampedCount: 11, failedCount: 1 }),
        summary({ seq: 2, createdAt: at(14, 10), finished: false, stampedCount: 3, coverPhotoId: null }),
        summary({ seq: 1, createdAt: at(14, 9), stampedCount: 0, failedCount: 12, coverPhotoId: null }),
      ],
      now,
    );
    const [ok, someFailed, processing, noneReady] = group?.rows ?? [];
    expect(ok).toMatchObject({
      line1: 'Veste/ M e L',
      price: '10.000 kz',
      meta: 'Lote 4 · 12 fotos',
      status: null,
      cover: { src: '/api/photos/p4/thumb?v=s', state: 'normal' },
    });
    expect(someFailed?.status).toEqual({ tone: 'error', text: '1 falhou' });
    expect(processing?.status).toEqual({ tone: 'progress', text: 'A processar' });
    expect(processing?.cover).toEqual({ src: null, state: 'processing' });
    expect(noneReady?.status).toEqual({ tone: 'error', text: 'Nenhuma ficou pronta' });
    expect(noneReady?.cover).toEqual({ src: null, state: 'error' });
  });

  it('says "1 foto" for a one-photo batch', () => {
    const [group] = groupByDay([summary({ seq: 2, createdAt: at(14, 9), photoCount: 1 })], now);
    expect(group?.rows[0]?.meta).toBe('Lote 2 · 1 foto');
  });
});

describe('list cache helpers', () => {
  const data = {
    pageParams: [0, 3],
    pages: [
      {
        batches: [summary({ seq: 4, createdAt: at(14, 9) }), summary({ seq: 3, createdAt: at(14, 8) })],
        nextBefore: 3,
      },
      { batches: [summary({ seq: 2, createdAt: at(13, 9), finished: false })], nextBefore: null },
    ] satisfies BatchPage[],
  };

  it('anyInProgress looks at every loaded page', () => {
    expect(anyInProgress(data)).toBe(true);
    expect(anyInProgress(withoutBatch(data, 'b2'))).toBe(false);
    expect(anyInProgress(undefined)).toBe(false);
  });

  it('withoutBatch drops one batch and keeps the pages', () => {
    const next = withoutBatch(data, 'b3');
    expect(next?.pages.map((p) => p.batches.map((b) => b.seq))).toEqual([[4], [2]]);
    expect(next?.pageParams).toEqual([0, 3]);
    expect(withoutBatch(undefined, 'b3')).toBeUndefined();
  });
});
