import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotoViewer, type ViewerPhoto } from './PhotoViewer';

const photos: ViewerPhoto[] = [
  { id: 'p1', position: 1 },
  { id: 'p2', position: 2 },
  { id: 'p4', position: 4 },
];

function renderViewer(index: number | null, extra: { footer?: (p: ViewerPhoto) => string } = {}) {
  const onIndexChange = vi.fn();
  const onClose = vi.fn();
  const result = render(
    <PhotoViewer
      photos={photos}
      index={index}
      onIndexChange={onIndexChange}
      onClose={onClose}
      footer={extra.footer}
    />,
  );
  return { ...result, onIndexChange, onClose };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PhotoViewer', () => {
  it('stays closed without an index', () => {
    renderViewer(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on the chosen photo with its full stamped image and the counter', () => {
    renderViewer(1, { footer: (p) => `ações da foto ${p.position}` });
    const dialog = screen.getByRole('dialog', { name: 'Pré-visualização' });
    expect(dialog).toHaveTextContent('2 de 3');
    expect(screen.getByRole('img', { name: 'Foto 2, carimbada' })).toHaveAttribute(
      'src',
      '/api/photos/p2/stamped',
    );
    expect(screen.getByText('ações da foto 2')).toBeInTheDocument();
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('moves with the arrows and hides them at the ends', async () => {
    const user = userEvent.setup();
    const { onIndexChange } = renderViewer(0, { footer: (p) => `ações da foto ${p.position}` });
    expect(screen.getByRole('button', { name: 'Foto anterior', hidden: true })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Foto seguinte' }));
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole('dialog')).toHaveTextContent('2 de 3');

    await user.click(screen.getByRole('button', { name: 'Foto seguinte' }));
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
    expect(screen.getByText('ações da foto 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Foto seguinte', hidden: true })).toBeDisabled();
  });

  it('moves with the keyboard arrows', async () => {
    const user = userEvent.setup();
    const { onIndexChange } = renderViewer(1);
    screen.getByRole('button', { name: 'Fechar' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
  });

  it('closes with the close button and with Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderViewer(0);
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('reports the photo a swipe settles on', () => {
    vi.useFakeTimers();
    const { onIndexChange } = renderViewer(0);
    const track = screen.getByTestId('viewer-track');
    Object.defineProperty(track, 'clientWidth', { configurable: true, value: 390 });
    Object.defineProperty(track, 'scrollLeft', { configurable: true, value: 780 });
    fireEvent.scroll(track);
    expect(screen.getByRole('dialog')).toHaveTextContent('3 de 3');
    expect(onIndexChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onIndexChange).toHaveBeenCalledWith(2);
  });

  it('follows a new index from the parent (browser back and forward)', () => {
    const { rerender, onIndexChange, onClose } = renderViewer(0);
    rerender(<PhotoViewer photos={photos} index={2} onIndexChange={onIndexChange} onClose={onClose} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('3 de 3');
    rerender(<PhotoViewer photos={photos} index={null} onIndexChange={onIndexChange} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.documentElement.style.overflow).toBe('');
  });
});
