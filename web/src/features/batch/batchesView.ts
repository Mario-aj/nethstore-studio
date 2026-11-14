// Pure logic of the "Lotes" screen: batches grouped by day, and what each row says.

import type { InfiniteData } from '@tanstack/react-query';
import { photoUrls } from '../../shared/api/endpoints';
import type { BatchPage, BatchSummary } from '../../shared/api/schemas';
import { t } from '../../shared/i18n/pt-AO';
import { formatShortDate } from '../../shared/lib/format';

export interface BatchRow {
  id: string;
  seq: number;
  line1: string;
  price: string;
  meta: string;
  /** Only when something needs attention: still processing, or photos that failed. */
  status: { tone: 'progress' | 'error'; text: string } | null;
  cover: { src: string | null; state: 'normal' | 'processing' | 'error' };
}

export interface DayGroup {
  key: string;
  label: string;
  rows: BatchRow[];
}

function rowOf(batch: BatchSummary): BatchRow {
  let status: BatchRow['status'] = null;
  if (!batch.finished) status = { tone: 'progress', text: t.batches.processing };
  else if (batch.stampedCount === 0) status = { tone: 'error', text: t.batches.noneReady };
  else if (batch.failedCount > 0) status = { tone: 'error', text: t.batches.failed(batch.failedCount) };

  // `?v=s` is the same URL the Pronto screen uses, so the browser reuses the cached thumbnail.
  const src = batch.coverPhotoId ? `${photoUrls.thumb(batch.coverPhotoId)}?v=s` : null;
  const state = src ? 'normal' : batch.finished ? 'error' : 'processing';
  return {
    id: batch.id,
    seq: batch.seq,
    line1: batch.stampLine1,
    price: batch.stampLine2,
    meta: t.batches.meta(batch.seq, batch.photoCount),
    status,
    cover: { src, state },
  };
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function dayLabel(date: Date, now: Date): string {
  if (dayKey(date) === dayKey(now)) return t.batches.today;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return t.batches.yesterday;
  return formatShortDate(date);
}

/** Batches (newest first) grouped by the day they were created, in the device time zone. */
export function groupByDay(batches: readonly BatchSummary[], now: Date): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const batch of batches) {
    const created = new Date(batch.createdAt);
    const key = dayKey(created);
    let group = groups.at(-1);
    if (group?.key !== key) {
      group = { key, label: dayLabel(created, now), rows: [] };
      groups.push(group);
    }
    group.rows.push(rowOf(batch));
  }
  return groups;
}

export function allBatches(data: InfiniteData<BatchPage> | undefined): BatchSummary[] {
  return data?.pages.flatMap((page) => page.batches) ?? [];
}

/** The list keeps refreshing while a batch is still being processed. */
export function anyInProgress(data: InfiniteData<BatchPage> | undefined): boolean {
  return allBatches(data).some((batch) => !batch.finished);
}

/** Cached list without one batch, so "back" after "Apagar lote" does not show it again. */
export function withoutBatch(
  data: InfiniteData<BatchPage> | undefined,
  id: string,
): InfiniteData<BatchPage> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({ ...page, batches: page.batches.filter((b) => b.id !== id) })),
  };
}
