import { useSyncExternalStore } from 'react';
import { isApiError } from '../../shared/api/client';
import { api } from '../../shared/api/endpoints';
import { postPolicyUpload, UploadError } from '../../shared/lib/postPolicyUpload';
import { ResizeError, resizeImage } from '../../shared/lib/resize';
import { workInProgress } from '../../shared/lib/workInProgress';
import { createUploadManager, type UploadSnapshot } from './uploadManager';

/** The app-wide upload manager, wired to the real API, worker and XHR. */
export const uploads = createUploadManager({
  resize: resizeImage,
  upload: postPolicyUpload,
  confirm: async (photoId) => {
    await api.confirmUploaded(photoId);
  },
  newSlot: (photoId) => api.uploadSlot(photoId),
  markFailed: async (photoId) => {
    await api.uploadFailed(photoId);
  },
  ping: async () => {
    try {
      await api.health();
      return true;
    } catch {
      return false;
    }
  },
  isNetworkError: (error) =>
    (error instanceof UploadError && error.kind === 'network') || (isApiError(error) && error.isNetwork),
  isPermanentError: (error) => error instanceof ResizeError,
  isAlreadyUploaded: (error) => isApiError(error) && error.code === 'invalid_state',
  now: () => Date.now(),
  setTimer: (callback, ms) => window.setTimeout(callback, ms),
  clearTimer: (handle) => window.clearTimeout(handle as number),
});

// A reload (for example "Atualizar" on a new version) would drop the files still in memory.
uploads.subscribe(() => {
  workInProgress.set(Object.values(uploads.getSnapshot().batches).some((batch) => batch?.active));
});

export function useUploads(): UploadSnapshot {
  return useSyncExternalStore(uploads.subscribe, uploads.getSnapshot, uploads.getSnapshot);
}
