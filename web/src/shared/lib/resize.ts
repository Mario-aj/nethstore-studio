import type { ResizeRequest, ResizeResponse } from './resize.worker';

export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.88;

export class ResizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResizeError';
  }
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (blob: Blob) => void; reject: (error: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./resize.worker.ts', import.meta.url), { type: 'module', name: 'resize' });
  worker.onmessage = (event: MessageEvent<ResizeResponse>) => {
    const data = event.data;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.ok) entry.resolve(data.blob);
    else entry.reject(new ResizeError(data.error));
  };
  worker.onerror = () => {
    for (const entry of pending.values()) entry.reject(new ResizeError('worker crashed'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Resized JPEG of `file` (long side <= 1600 px, quality 0.88), made in a Web Worker. */
export function resizeImage(file: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    const request: ResizeRequest = { id, file, maxSide: MAX_SIDE, quality: JPEG_QUALITY };
    getWorker().postMessage(request);
  });
}
