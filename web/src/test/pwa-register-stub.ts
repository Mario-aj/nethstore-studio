// Test stand-in for `virtual:pwa-register/react` (only exists inside the Vite PWA plugin).
export function useRegisterSW() {
  return {
    needRefresh: [false, () => undefined] as const,
    offlineReady: [false, () => undefined] as const,
    updateServiceWorker: () => Promise.resolve(),
  };
}
