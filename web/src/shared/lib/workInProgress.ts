import { useSyncExternalStore } from 'react';

/**
 * Whether the app holds work that a page reload would lose (photos still being sent).
 * Set by the upload manager, read by the update prompt, so "Atualizar" never shows up
 * in the middle of an upload.
 */
let busy = false;
const listeners = new Set<() => void>();

export const workInProgress = {
  set: (value: boolean) => {
    if (value === busy) return;
    busy = value;
    listeners.forEach((listener) => listener());
  },
  get: () => busy,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useWorkInProgress(): boolean {
  return useSyncExternalStore(workInProgress.subscribe, workInProgress.get, workInProgress.get);
}
