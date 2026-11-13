import { useEffect, useState } from 'react';

/** Current time, refreshed every `intervalMs` while `active`. */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

/** Whole seconds left until `until` (epoch ms), ticking every second; 0 when there is nothing to wait for. */
export function useCountdown(until: number | null): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (until === null) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(seconds);
      return seconds;
    };
    if (tick() === 0) return;
    const id = window.setInterval(() => {
      if (tick() === 0) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [until]);
  return until === null ? 0 : left;
}
