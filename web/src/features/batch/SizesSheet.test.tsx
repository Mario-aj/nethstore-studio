import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SizesSheet } from './SizesSheet';

describe('SizesSheet', () => {
  it('lists XS to 2XL, previews the stamp and applies in canonical order', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<SizesSheet open sizes={[]} description="Veste" onApply={onApply} onClose={() => undefined} />);
    const chips = ['XS', 'S', 'M', 'L', 'XL', '2XL'].map((s) => screen.getByRole('button', { name: s }));
    expect(chips).toHaveLength(6);
    await user.click(screen.getByRole('button', { name: 'L' }));
    await user.click(screen.getByRole('button', { name: 'M' }));
    expect(screen.getByRole('button', { name: 'M' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Veste/ M e L')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onApply).toHaveBeenCalledWith(['M', 'L']);
  });

  it('starts from the applied sizes and Limpar clears the draft', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<SizesSheet open sizes={['S', 'M']} description="" onApply={onApply} onClose={() => undefined} />);
    expect(screen.getByText('S e M')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(screen.getByText('escolhe um tamanho')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onApply).toHaveBeenCalledWith([]);
  });

  it('uses a modal dialog', () => {
    render(<SizesSheet open sizes={[]} description="" onApply={() => undefined} onClose={() => undefined} />);
    expect(screen.getByRole('dialog', { name: 'Tamanhos' })).toBeInTheDocument();
  });
});
