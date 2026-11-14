import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workInProgress } from '../shared/lib/workInProgress';
import { UpdatePrompt } from './UpdatePrompt';

const apply = vi.fn();
let announceUpdate: () => void = () => undefined;

vi.mock('./serviceWorkerUpdates', () => ({
  watchForUpdates: ({ onUpdateReady }: { onUpdateReady: () => void }) => {
    announceUpdate = onUpdateReady;
    return { apply, stop: vi.fn() };
  },
}));

beforeEach(() => {
  apply.mockReset();
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} });
});
afterEach(() => {
  workInProgress.set(false);
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

const prompt = () => screen.queryByText('Nova versão disponível');

describe('UpdatePrompt', () => {
  it('appears when a new version is ready and Atualizar applies it', async () => {
    const user = userEvent.setup();
    render(<UpdatePrompt />);
    expect(prompt()).not.toBeInTheDocument();

    act(() => announceUpdate());
    expect(prompt()).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('stays out of the way while photos are being sent', () => {
    render(<UpdatePrompt />);
    act(() => workInProgress.set(true));
    act(() => announceUpdate());
    expect(prompt()).not.toBeInTheDocument();

    act(() => workInProgress.set(false));
    expect(prompt()).toBeInTheDocument();
  });

  it('Agora não hides it until the app comes back to the screen', async () => {
    const user = userEvent.setup();
    render(<UpdatePrompt />);
    act(() => announceUpdate());
    await user.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(prompt()).not.toBeInTheDocument();

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(prompt()).toBeInTheDocument();
  });
});
