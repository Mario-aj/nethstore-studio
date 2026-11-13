// Upload manager (SPEC 11.4). Lives outside the React tree so navigating between
// screens never cancels uploads; components read it with useSyncExternalStore.
//
// Rules:
// * up to 3 photos in flight (resize -> POST policy upload -> confirm);
// * an HTTP error from storage or API costs one attempt; after 3 the photo is
//   reported with `upload-failed`. Before every retry a fresh `upload-slot` is
//   requested;
// * a network error (no answer) pauses the whole queue without costing attempts;
//   every 8 s the manager pings /api/health and resumes when it answers.

import type { CreatedBatch, UploadSlot } from '../../shared/api/schemas';

export const CONCURRENCY = 3;
export const MAX_ATTEMPTS = 3;
export const BACKOFF_MS = [1000, 3000] as const;
export const OFFLINE_RETRY_MS = 8000;
/** Refresh the slot when it expires within this window. */
const SLOT_MARGIN_MS = 60_000;

export type ItemState = 'queued' | 'working' | 'done' | 'failed';

export interface UploadItemView {
  photoId: string;
  position: number;
  state: ItemState;
  progress: number;
  attempts: number;
  hasFile: boolean;
}

export interface BatchUploadView {
  batchId: string;
  items: readonly UploadItemView[];
  /** True while at least one photo is queued or in flight. */
  active: boolean;
  doneCount: number;
  failedCount: number;
}

export interface UploadSnapshot {
  batches: Readonly<Record<string, BatchUploadView>>;
  paused: boolean;
  /** Epoch ms of the next connection check while paused. */
  retryAt: number | null;
  /** Epoch ms of the last time the connection came back. */
  reconnectedAt: number | null;
}

export interface UploadDeps {
  resize(file: File): Promise<Blob>;
  upload(slot: UploadSlot, blob: Blob, onProgress: (fraction: number) => void): Promise<void>;
  confirm(photoId: string): Promise<void>;
  newSlot(photoId: string): Promise<UploadSlot>;
  markFailed(photoId: string): Promise<void>;
  /** Resolves true when the server answers. */
  ping(): Promise<boolean>;
  isNetworkError(error: unknown): boolean;
  /** True when retrying cannot help (for example a file the browser cannot decode). */
  isPermanentError(error: unknown): boolean;
  /** True when the error means the photo is already past `awaiting_upload` on the server. */
  isAlreadyUploaded(error: unknown): boolean;
  now(): number;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

interface Item {
  photoId: string;
  position: number;
  file: File | null;
  blob: Blob | null;
  slot: UploadSlot | null;
  state: ItemState;
  progress: number;
  attempts: number;
  notBefore: number;
}

interface Entry {
  batchId: string;
  items: Item[];
}

export interface UploadManager {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => UploadSnapshot;
  /** Starts uploading a freshly created batch; files are matched to photos by position. */
  start: (batch: CreatedBatch, files: readonly File[]) => void;
  /** True when the manager knows this photo (it has or had its file in this session). */
  has: (batchId: string, photoId: string) => boolean;
  /** Retries a failed photo whose file is still in memory. Returns false without the file. */
  retry: (batchId: string, photoId: string) => boolean;
  /** Uploads a photo again with a file picked anew (after a reload lost the original). */
  reselect: (batchId: string, photoId: string, position: number, file: File) => void;
  /** Forgets a batch (frees files). */
  forget: (batchId: string) => void;
}

export function createUploadManager(deps: UploadDeps): UploadManager {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let running = 0;
  let paused = false;
  let retryAt: number | null = null;
  let reconnectedAt: number | null = null;
  let pumpTimer: unknown = null;
  let offlineTimer: unknown = null;
  let snapshot: UploadSnapshot = { batches: {}, paused: false, retryAt: null, reconnectedAt: null };

  function buildSnapshot(): UploadSnapshot {
    const batches: Record<string, BatchUploadView> = {};
    for (const entry of entries.values()) {
      const items = entry.items.map<UploadItemView>((item) => ({
        photoId: item.photoId,
        position: item.position,
        state: item.state,
        progress: item.progress,
        attempts: item.attempts,
        hasFile: item.file !== null || item.blob !== null,
      }));
      batches[entry.batchId] = {
        batchId: entry.batchId,
        items,
        active: items.some((i) => i.state === 'queued' || i.state === 'working'),
        doneCount: items.filter((i) => i.state === 'done').length,
        failedCount: items.filter((i) => i.state === 'failed').length,
      };
    }
    return { batches, paused, retryAt, reconnectedAt };
  }

  function emit() {
    snapshot = buildSnapshot();
    for (const listener of listeners) listener();
  }

  function findItem(batchId: string, photoId: string): Item | undefined {
    return entries.get(batchId)?.items.find((item) => item.photoId === photoId);
  }

  function nextReady(now: number): Item | null {
    for (const entry of entries.values()) {
      for (const item of entry.items) {
        if (item.state === 'queued' && item.notBefore <= now) return item;
      }
    }
    return null;
  }

  function earliestWaiting(): number | null {
    let earliest: number | null = null;
    for (const entry of entries.values()) {
      for (const item of entry.items) {
        if (item.state === 'queued' && (earliest === null || item.notBefore < earliest))
          earliest = item.notBefore;
      }
    }
    return earliest;
  }

  function schedulePump(at: number) {
    if (pumpTimer !== null) deps.clearTimer(pumpTimer);
    pumpTimer = deps.setTimer(
      () => {
        pumpTimer = null;
        pump();
      },
      Math.max(0, at - deps.now()),
    );
  }

  function pump() {
    if (paused) {
      emit();
      return;
    }
    const now = deps.now();
    while (running < CONCURRENCY) {
      const item = nextReady(now);
      if (!item) break;
      running += 1;
      item.state = 'working';
      void run(item).finally(() => {
        running -= 1;
        pump();
      });
    }
    const earliest = earliestWaiting();
    if (earliest !== null && earliest > now && running < CONCURRENCY) schedulePump(earliest);
    emit();
  }

  function goOffline() {
    if (paused) return;
    paused = true;
    retryAt = deps.now() + OFFLINE_RETRY_MS;
    offlineTimer = deps.setTimer(checkConnection, OFFLINE_RETRY_MS);
    emit();
  }

  function checkConnection() {
    offlineTimer = null;
    void deps.ping().then(
      (ok) => {
        if (ok) {
          paused = false;
          retryAt = null;
          reconnectedAt = deps.now();
          pump();
        } else {
          retryAt = deps.now() + OFFLINE_RETRY_MS;
          offlineTimer = deps.setTimer(checkConnection, OFFLINE_RETRY_MS);
          emit();
        }
      },
      () => {
        retryAt = deps.now() + OFFLINE_RETRY_MS;
        offlineTimer = deps.setTimer(checkConnection, OFFLINE_RETRY_MS);
        emit();
      },
    );
  }

  function slotIsFresh(slot: UploadSlot | null): slot is UploadSlot {
    if (!slot) return false;
    const expires = Date.parse(slot.expiresAt);
    return Number.isNaN(expires) || expires - SLOT_MARGIN_MS > deps.now();
  }

  async function fail(item: Item) {
    item.state = 'failed';
    item.progress = 0;
    item.slot = null;
    try {
      await deps.markFailed(item.photoId);
    } catch {
      // The page reconciles on the next load (orphan detection) or the janitor does after 24 h.
    }
  }

  function markDone(item: Item) {
    item.state = 'done';
    item.progress = 1;
    item.file = null;
    item.blob = null;
    item.slot = null;
  }

  async function run(item: Item) {
    try {
      if (!item.blob) {
        if (!item.file) throw new Error('no file');
        item.blob = await deps.resize(item.file);
      }
      if (!slotIsFresh(item.slot)) item.slot = await deps.newSlot(item.photoId);
      await deps.upload(item.slot, item.blob, (fraction) => {
        item.progress = fraction;
        emit();
      });
      await deps.confirm(item.photoId);
      markDone(item);
    } catch (error) {
      if (deps.isAlreadyUploaded(error)) {
        // The server already moved the photo past `awaiting_upload` (for example a
        // confirmation whose answer got lost). Nothing left to upload.
        markDone(item);
        return;
      }
      item.progress = 0;
      if (deps.isNetworkError(error)) {
        item.state = 'queued';
        goOffline();
        return;
      }
      item.attempts += 1;
      if (deps.isPermanentError(error) || item.attempts >= MAX_ATTEMPTS) {
        await fail(item);
        return;
      }
      item.state = 'queued';
      item.slot = null; // SPEC 11.4: ask for a new policy before trying again.
      item.notBefore = deps.now() + (BACKOFF_MS[item.attempts - 1] ?? BACKOFF_MS[1]);
    }
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,

    start: (batch, files) => {
      const byPosition = [...batch.photos].sort((a, b) => a.position - b.position);
      entries.set(batch.id, {
        batchId: batch.id,
        items: byPosition.map((photo, index) => ({
          photoId: photo.id,
          position: photo.position,
          file: files[index] ?? null,
          blob: null,
          slot: photo.upload,
          state: files[index] ? 'queued' : 'failed',
          progress: 0,
          attempts: 0,
          notBefore: 0,
        })),
      });
      pump();
    },

    has: (batchId, photoId) => {
      return findItem(batchId, photoId) !== undefined;
    },

    retry: (batchId, photoId) => {
      const item = findItem(batchId, photoId);
      if (!item || item.state !== 'failed' || (!item.file && !item.blob)) return false;
      item.state = 'queued';
      item.attempts = 0;
      item.slot = null;
      item.notBefore = 0;
      pump();
      return true;
    },

    reselect: (batchId, photoId, position, file) => {
      let entry = entries.get(batchId);
      if (!entry) {
        entry = { batchId, items: [] };
        entries.set(batchId, entry);
      }
      const existing = entry.items.find((item) => item.photoId === photoId);
      const item: Item = existing ?? {
        photoId,
        position,
        file: null,
        blob: null,
        slot: null,
        state: 'queued',
        progress: 0,
        attempts: 0,
        notBefore: 0,
      };
      if (existing?.state === 'working') return;
      Object.assign(item, {
        file,
        blob: null,
        slot: null,
        state: 'queued',
        progress: 0,
        attempts: 0,
        notBefore: 0,
      });
      if (!existing) entry.items.push(item);
      pump();
    },

    forget: (batchId) => {
      entries.delete(batchId);
      if (offlineTimer !== null && entries.size === 0) {
        deps.clearTimer(offlineTimer);
        offlineTimer = null;
        paused = false;
        retryAt = null;
      }
      emit();
    },
  };
}
