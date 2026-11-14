import { ApiError } from '../api/client';
import { photoUrls } from '../api/endpoints';

/** `attachment; filename="nethstore-007-003.jpg"` -> "nethstore-007-003.jpg". */
export function filenameFrom(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const match = /filename="?([^";]+)"?/i.exec(contentDisposition);
  const name = match?.[1]?.trim();
  return name && /^[\w.-]+$/.test(name) ? name : null;
}

const pad3 = (n: number) => String(n).padStart(3, '0');

/** Same naming as the API: nethstore-{batch seq}-{photo position}.jpg */
export function fallbackFilename(seq: number, position: number): string {
  return `nethstore-${pad3(seq)}-${pad3(position)}.jpg`;
}

/** Downloads a stamped photo through the API (session cookie) as a File. */
export async function fetchStampedFile(photoId: string, fallbackName: string): Promise<File> {
  let res: Response;
  try {
    res = await fetch(photoUrls.stamped(photoId), { credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (!res.ok) throw new ApiError(res.status, res.status === 404 ? 'not_ready' : 'internal');
  const blob = await res.blob();
  const name = filenameFrom(res.headers.get('Content-Disposition')) ?? fallbackName;
  return new File([blob], name, { type: 'image/jpeg' });
}

/** Saves a file through a temporary <a download> (SPEC 11.3, "Guardar todas na galeria"). */
export function saveFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** True when this browser can share image files (Web Share level 2). */
export function canShareFiles(): boolean {
  if (typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({
      files: [new File([new Uint8Array([0xff, 0xd8, 0xff])], 'teste.jpg', { type: 'image/jpeg' })],
    });
  } catch {
    return false;
  }
}

export const SHARE_GROUP = 10;

/** iPhone or iPad, whatever the browser (they all run WebKit). iPadOS reports a Mac with touch. */
export function isAppleTouchDevice(
  nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator,
): boolean {
  return (
    /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)
  );
}

/**
 * How "Guardar" reaches the gallery. iOS turns every `<a download>` into a separate
 * preview screen and files land in Files, not Photos; its share sheet instead saves
 * many images to Photos in one tap ("Guardar imagens"). Elsewhere downloads work.
 */
export type SaveMode = 'download' | 'share';

export function saveMode(): SaveMode {
  return isAppleTouchDevice() && canShareFiles() ? 'share' : 'download';
}

export const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
