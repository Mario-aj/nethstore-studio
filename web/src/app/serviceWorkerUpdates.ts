/**
 * Service worker registration and update flow (DECISOES.md, "Atualizações da app").
 *
 * The browser only looks for a new sw.js on navigations, and the installed app is a
 * single page that can stay open for days. So it also asks on start, whenever the app
 * comes back to the screen or back online, and every 15 minutes while it is visible.
 * A new version found mid-session waits for "Atualizar"; one already waiting when the
 * app starts is applied at once, before there is anything on screen to lose.
 */

export const UPDATE_CHECK_MS = 15 * 60 * 1000;

export interface UpdateWatch {
  /** Activates the waiting version; the page reloads once it takes control. */
  apply: () => void;
  stop: () => void;
}

interface WatchOptions {
  onUpdateReady: () => void;
  container?: ServiceWorkerContainer;
  scriptUrl?: string;
  checkEveryMs?: number;
  isVisible?: () => boolean;
  reload?: () => void;
}

export function watchForUpdates({
  onUpdateReady,
  container = navigator.serviceWorker,
  scriptUrl = '/sw.js',
  checkEveryMs = UPDATE_CHECK_MS,
  isVisible = () => document.visibilityState === 'visible',
  reload = () => window.location.reload(),
}: WatchOptions): UpdateWatch {
  let registration: ServiceWorkerRegistration | null = null;
  let applying = false;
  let stopped = false;
  const cleanups: (() => void)[] = [];

  const listen = (target: EventTarget, type: string, listener: () => void) => {
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener(type, listener));
  };

  const apply = () => {
    const waiting = registration?.waiting;
    if (!waiting) return;
    applying = true;
    // The generated sw.js calls skipWaiting() on this message (registerType "prompt").
    waiting.postMessage({ type: 'SKIP_WAITING' });
  };

  const check = () => {
    if (!registration || !isVisible()) return;
    // Offline or server down: the next check tries again.
    registration.update().catch(() => undefined);
  };

  // A worker that finishes installing while another one controls the page is an update.
  // (The very first install has no controller and is not.)
  const track = (worker: ServiceWorker) => {
    listen(worker, 'statechange', () => {
      if (worker.state === 'installed' && container.controller) onUpdateReady();
    });
  };

  // Reload only when we asked for the switch, never on a first install.
  listen(container, 'controllerchange', () => {
    if (applying) reload();
  });

  container.register(scriptUrl, { scope: '/', updateViaCache: 'none' }).then(
    (reg) => {
      if (stopped) return;
      registration = reg;
      listen(reg, 'updatefound', () => {
        if (reg.installing) track(reg.installing);
      });
      if (reg.installing) track(reg.installing);
      if (reg.waiting && container.controller) apply();

      listen(document, 'visibilitychange', check);
      listen(window, 'online', check);
      const timer = window.setInterval(check, checkEveryMs);
      cleanups.push(() => window.clearInterval(timer));
    },
    // No service worker (for example a private window): the app works without it.
    () => undefined,
  );

  return {
    apply,
    stop: () => {
      stopped = true;
      cleanups.splice(0).forEach((cleanup) => cleanup());
    },
  };
}
