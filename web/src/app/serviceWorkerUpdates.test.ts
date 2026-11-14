import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_CHECK_MS, watchForUpdates } from './serviceWorkerUpdates';

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  postMessage = vi.fn();
  become(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  update = vi.fn(() => Promise.resolve());
  /** The browser found a new sw.js and started installing it. */
  found(): FakeWorker {
    const worker = new FakeWorker();
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
    return worker;
  }
}

class FakeContainer extends EventTarget {
  controller: object | null = {};
  registration = new FakeRegistration();
  register = vi.fn(() => Promise.resolve(this.registration));
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function setup({ controller = true, visible = true } = {}) {
  const container = new FakeContainer();
  container.controller = controller ? {} : null;
  const state = { visible };
  const onUpdateReady = vi.fn();
  const reload = vi.fn();
  const watch = watchForUpdates({
    onUpdateReady,
    reload,
    container: container as unknown as ServiceWorkerContainer,
    isVisible: () => state.visible,
  });
  return { container, registration: container.registration, state, onUpdateReady, reload, watch };
}

describe('watchForUpdates', () => {
  let stop: (() => void) | undefined;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    stop?.();
    vi.useRealTimers();
  });

  it('registers /sw.js for the whole app, bypassing the HTTP cache', async () => {
    const { container, watch } = setup();
    stop = watch.stop;
    await flush();
    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
  });

  it('a version found while the app is open waits for Atualizar, then reloads into it', async () => {
    const { container, registration, onUpdateReady, reload, watch } = setup();
    stop = watch.stop;
    await flush();

    const worker = registration.found();
    expect(onUpdateReady).not.toHaveBeenCalled();
    worker.become('installed');
    registration.installing = null;
    registration.waiting = worker;
    expect(onUpdateReady).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).not.toHaveBeenCalled();

    watch.apply();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('the first install is not an update and never reloads', async () => {
    const { container, registration, onUpdateReady, reload, watch } = setup({ controller: false });
    stop = watch.stop;
    await flush();
    registration.found().become('installed');
    container.dispatchEvent(new Event('controllerchange'));
    expect(onUpdateReady).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('a version already waiting when the app starts is applied at once', async () => {
    const container = new FakeContainer();
    const waiting = new FakeWorker();
    waiting.state = 'installed';
    container.registration.waiting = waiting;
    const reload = vi.fn();
    stop = watchForUpdates({
      onUpdateReady: vi.fn(),
      reload,
      container: container as unknown as ServiceWorkerContainer,
      isVisible: () => true,
    }).stop;
    await flush();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('asks for a new version when the app comes back, goes online and every 15 minutes', async () => {
    const { registration, state, watch } = setup();
    stop = watch.stop;
    await flush();

    document.dispatchEvent(new Event('visibilitychange'));
    expect(registration.update).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    expect(registration.update).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(registration.update).toHaveBeenCalledTimes(3);

    // Not while the app is in the background.
    state.visible = false;
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(registration.update).toHaveBeenCalledTimes(3);
  });

  it('a failed check (offline) is ignored', async () => {
    const { registration, watch } = setup();
    stop = watch.stop;
    await flush();
    registration.update.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('stop removes the listeners and the timer', async () => {
    const { registration, onUpdateReady, watch } = setup();
    await flush();
    watch.stop();
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    registration.found().become('installed');
    expect(registration.update).not.toHaveBeenCalled();
    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it('without a service worker (private window) the app goes on', async () => {
    const container = new FakeContainer();
    container.register.mockRejectedValueOnce(new DOMException('denied', 'SecurityError'));
    const watch = watchForUpdates({
      onUpdateReady: vi.fn(),
      container: container as unknown as ServiceWorkerContainer,
    });
    stop = watch.stop;
    await flush();
    expect(() => watch.apply()).not.toThrow();
  });
});
