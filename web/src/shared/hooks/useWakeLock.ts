import { useEffect } from 'react';

interface WakeLockSentinelLike {
  release(): Promise<void>;
  released: boolean;
}

/** Keeps the screen on while `active` (SPEC 11.3, during upload). Re-acquired when the page is visible again. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const wakeLock = (
      navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } }
    ).wakeLock;
    if (!wakeLock) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      wakeLock.request('screen').then(
        (s) => {
          if (cancelled) void s.release();
          else sentinel = s;
        },
        () => {
          // Denied (battery saver, insecure context). Uploads continue anyway.
        },
      );
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [active]);
}
