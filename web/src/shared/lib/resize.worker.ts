// Resizes photos off the main thread (SPEC 11.4): honours EXIF orientation, caps
// the long side at 1600 px and re-encodes as JPEG, which also drops EXIF and GPS.

export interface ResizeRequest {
  id: number;
  file: Blob;
  maxSide: number;
  quality: number;
}

export type ResizeResponse =
  | { id: number; ok: true; blob: Blob; width: number; height: number }
  | { id: number; ok: false; error: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<ResizeRequest>) => void) | null;
  postMessage(message: ResizeResponse): void;
}

const scope = globalThis as unknown as WorkerScope;

async function resize({ file, maxSide, quality }: ResizeRequest) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    // JPEG has no alpha: paint white under transparent images instead of black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  resize(request).then(
    ({ blob, width, height }) => scope.postMessage({ id: request.id, ok: true, blob, width, height }),
    (error: unknown) => scope.postMessage({ id: request.id, ok: false, error: String(error) }),
  );
};
