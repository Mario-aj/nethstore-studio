import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreatedBatch, UploadSlot } from '../../shared/api/schemas';
import { createUploadManager, OFFLINE_RETRY_MS, type UploadDeps } from './uploadManager';

class NetworkError extends Error {}
class HttpError extends Error {
  readonly code: string;
  constructor(code = 'http') {
    super(code);
    this.code = code;
  }
}
class BadImage extends Error {}

const slot = (n = 0): UploadSlot => ({
  url: '/s3/estudio',
  fields: { key: `k${n}` },
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
});

function batch(n: number): CreatedBatch {
  return {
    id: 'b1',
    seq: 1,
    stampLine1: 'M',
    stampLine2: '1 kz',
    photos: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, position: i + 1, upload: slot(i) })),
  };
}
const files = (n: number) => Array.from({ length: n }, (_, i) => new File(['x'], `f${i}.jpg`));

function setup(overrides: Partial<UploadDeps> = {}) {
  const deps: UploadDeps = {
    resize: vi.fn((file: File) => Promise.resolve(new Blob([file.name]))),
    upload: vi.fn(() => Promise.resolve()),
    confirm: vi.fn(() => Promise.resolve()),
    newSlot: vi.fn(() => Promise.resolve(slot(99))),
    markFailed: vi.fn(() => Promise.resolve()),
    ping: vi.fn(() => Promise.resolve(true)),
    isNetworkError: (e) => e instanceof NetworkError,
    isPermanentError: (e) => e instanceof BadImage,
    isAlreadyUploaded: (e) => e instanceof HttpError && e.code === 'invalid_state',
    now: () => Date.now(),
    setTimer: (cb, ms) => setTimeout(cb, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    ...overrides,
  };
  const manager = createUploadManager(deps);
  const view = () => manager.getSnapshot().batches.b1;
  return { deps, manager, view };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('upload manager', () => {
  it('uploads every photo and confirms it', async () => {
    const { deps, manager, view } = setup();
    manager.start(batch(5), files(5));
    await vi.runAllTimersAsync();
    expect(deps.upload).toHaveBeenCalledTimes(5);
    expect(deps.confirm).toHaveBeenCalledTimes(5);
    expect(view()?.doneCount).toBe(5);
    expect(view()?.active).toBe(false);
    // The first attempt uses the slot that came with the batch.
    expect(deps.newSlot).not.toHaveBeenCalled();
  });

  it('keeps at most 3 uploads in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const { manager } = setup({
      upload: vi.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 100));
        inFlight -= 1;
      }),
    });
    manager.start(batch(10), files(10));
    await vi.runAllTimersAsync();
    expect(peak).toBe(3);
  });

  it('retries an HTTP failure with a fresh slot and gives up after 3 attempts', async () => {
    const upload = vi.fn((s: UploadSlot) =>
      s.fields.key === 'k0' || s.fields.key === 'k99' ? Promise.reject(new HttpError()) : Promise.resolve(),
    );
    const { deps, manager, view } = setup({ upload });
    manager.start(batch(2), files(2));
    await vi.runAllTimersAsync();
    const first = view()?.items.find((i) => i.photoId === 'p1');
    expect(first).toMatchObject({ state: 'failed', attempts: 3, hasFile: true });
    expect(deps.newSlot).toHaveBeenCalledTimes(2);
    expect(deps.markFailed).toHaveBeenCalledWith('p1');
    expect(view()?.items.find((i) => i.photoId === 'p2')?.state).toBe('done');
  });

  it('recovers when a retry succeeds', async () => {
    let calls = 0;
    const { deps, manager, view } = setup({
      upload: vi.fn(() => (++calls === 1 ? Promise.reject(new HttpError()) : Promise.resolve())),
    });
    manager.start(batch(1), files(1));
    await vi.runAllTimersAsync();
    expect(view()?.items[0]).toMatchObject({ state: 'done', attempts: 1 });
    expect(deps.newSlot).toHaveBeenCalledTimes(1);
    expect(deps.markFailed).not.toHaveBeenCalled();
  });

  it('pauses the queue on network errors without spending attempts, then resumes', async () => {
    let online = false;
    const { deps, manager } = setup({
      upload: vi.fn(() => (online ? Promise.resolve() : Promise.reject(new NetworkError()))),
      ping: vi.fn(() => Promise.resolve(online)),
    });
    manager.start(batch(3), files(3));
    await vi.advanceTimersByTimeAsync(10);
    let snap = manager.getSnapshot();
    expect(snap.paused).toBe(true);
    expect(snap.retryAt).not.toBeNull();
    expect(snap.batches.b1?.items.every((i) => i.attempts === 0 && i.state === 'queued')).toBe(true);

    await vi.advanceTimersByTimeAsync(OFFLINE_RETRY_MS);
    expect(deps.ping).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().paused).toBe(true);

    online = true;
    await vi.advanceTimersByTimeAsync(OFFLINE_RETRY_MS);
    await vi.runAllTimersAsync();
    snap = manager.getSnapshot();
    expect(snap.paused).toBe(false);
    expect(snap.reconnectedAt).not.toBeNull();
    expect(snap.batches.b1?.doneCount).toBe(3);
    expect(deps.markFailed).not.toHaveBeenCalled();
  });

  it('fails at once when the file cannot be decoded', async () => {
    const { deps, manager, view } = setup({ resize: vi.fn(() => Promise.reject(new BadImage())) });
    manager.start(batch(1), files(1));
    await vi.runAllTimersAsync();
    expect(view()?.items[0]).toMatchObject({ state: 'failed', attempts: 1 });
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.markFailed).toHaveBeenCalledWith('p1');
  });

  it('treats invalid_state on confirm as already uploaded', async () => {
    const { manager, view } = setup({ confirm: vi.fn(() => Promise.reject(new HttpError('invalid_state'))) });
    manager.start(batch(1), files(1));
    await vi.runAllTimersAsync();
    expect(view()?.items[0]?.state).toBe('done');
  });

  it('retry() re-queues a failed photo that still has its file', async () => {
    let fail = true;
    const { deps, manager, view } = setup({
      upload: vi.fn(() => (fail ? Promise.reject(new HttpError()) : Promise.resolve())),
    });
    manager.start(batch(1), files(1));
    await vi.runAllTimersAsync();
    expect(view()?.items[0]?.state).toBe('failed');
    fail = false;
    expect(manager.retry('b1', 'p1')).toBe(true);
    await vi.runAllTimersAsync();
    expect(view()?.items[0]?.state).toBe('done');
    expect(deps.newSlot).toHaveBeenCalledTimes(3);
  });

  it('retry() refuses unknown photos; reselect() uploads a newly picked file', async () => {
    const { deps, manager, view } = setup();
    expect(manager.retry('b1', 'nope')).toBe(false);
    manager.reselect('b1', 'p7', 7, new File(['y'], 'again.jpg'));
    expect(manager.has('b1', 'p7')).toBe(true);
    await vi.runAllTimersAsync();
    expect(view()?.items[0]).toMatchObject({ photoId: 'p7', state: 'done' });
    expect(deps.newSlot).toHaveBeenCalledWith('p7');
  });

  it('notifies subscribers', async () => {
    const { manager } = setup();
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    manager.start(batch(1), files(1));
    await vi.runAllTimersAsync();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});
