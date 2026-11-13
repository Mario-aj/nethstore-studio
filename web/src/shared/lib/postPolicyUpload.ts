import type { UploadSlot } from '../api/schemas';

/** `network` = no answer (offline, timeout); `http` = the storage answered with an error. */
export class UploadError extends Error {
  readonly kind: 'network' | 'http';
  readonly status: number;

  constructor(kind: 'network' | 'http', status = 0) {
    super(kind === 'network' ? 'upload network error' : `upload failed with ${status}`);
    this.name = 'UploadError';
    this.kind = kind;
    this.status = status;
  }
}

const TIMEOUT_MS = 120_000;

/**
 * Sends a multipart POST policy upload straight to the storage (SPEC 8): only the
 * fields the API returned, in that order, and the file last.
 */
export function postPolicyUpload(
  slot: UploadSlot,
  blob: Blob,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(slot.fields)) form.append(key, value);
    form.append('file', blob, 'photo.jpg');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', slot.url);
    xhr.timeout = TIMEOUT_MS;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new UploadError('http', xhr.status));
    };
    xhr.onerror = () => reject(new UploadError('network'));
    xhr.ontimeout = () => reject(new UploadError('network'));
    xhr.onabort = () => reject(new UploadError('network'));
    xhr.send(form);
  });
}
