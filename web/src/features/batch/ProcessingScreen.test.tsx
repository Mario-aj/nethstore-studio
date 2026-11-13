import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Batch } from '../../shared/api/schemas';
import { ProcessingScreen } from './ProcessingScreen';
import { processingView } from './processingView';

function batch(statuses: Batch['photos'][number]['status'][]): Batch {
  return {
    id: 'b1',
    seq: 1,
    priceKz: 10000,
    sizes: ['M', 'L'],
    description: 'Veste',
    stampLine1: 'Veste/ M e L',
    stampLine2: '10.000 kz',
    createdAt: '2026-11-13T19:00:00Z',
    steps: {
      upload: { state: 'pending' },
      prepare: { state: 'pending' },
      stamp: { state: 'pending' },
      ready: { state: 'pending' },
    },
    failedCount: 0,
    finished: false,
    photos: statuses.map((status, i) => ({
      id: `p${i + 1}`,
      position: i + 1,
      status,
      failedStep: status === 'failed' ? 'stamp' : null,
      errorCode: null,
    })),
  };
}

const props = {
  mode: 'lan' as const,
  retryInSeconds: null,
  reconnected: null,
  hiddenWarning: false,
  needPickCount: 0,
  retrying: false,
  onRetryFailed: vi.fn(),
  onContinue: vi.fn(),
  onNewGroup: vi.fn(),
  onDismissHidden: vi.fn(),
};

describe('ProcessingScreen', () => {
  it('renders the ring as a progressbar and the four steps with their state', () => {
    const view = processingView({
      batch: batch(['stamped', 'stamped', 'prepared', 'uploaded']),
      uploads: undefined,
      paused: false,
      mode: 'lan',
      accepted: false,
    });
    render(<ProcessingScreen view={view} {...props} />);
    expect(screen.getByRole('progressbar', { name: 'Progresso do lote' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    const steps = within(screen.getByRole('list', { name: 'Etapas' })).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(within(steps[0]!).getByRole('img', { name: 'Concluído' })).toBeInTheDocument();
    expect(within(steps[1]!).getByRole('img', { name: 'A carregar' })).toBeInTheDocument();
    expect(within(steps[3]!).getByRole('img', { name: 'Pendente' })).toBeInTheDocument();
    expect(screen.getByText('JÁ PRONTAS ·', { exact: false })).toBeInTheDocument();
  });

  it('offers "Seguir com N" and "Repetir N fotos" when photos failed', () => {
    const view = processingView({
      batch: batch(['stamped', 'stamped', 'failed']),
      uploads: undefined,
      paused: false,
      mode: 'lan',
      accepted: false,
    });
    render(<ProcessingScreen view={view} {...props} />);
    expect(screen.getByRole('heading', { name: 'Uma foto falhou' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seguir com 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Repetir 1 foto/ })).toBeInTheDocument();
  });

  it('shows the offline banner as an alert with the countdown', () => {
    const view = processingView({
      batch: batch(['uploaded', 'awaiting_upload']),
      uploads: undefined,
      paused: true,
      mode: 'lan',
      accepted: false,
    });
    render(<ProcessingScreen view={view} {...props} retryInSeconds={6} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Perdeste a ligação ao computador');
    expect(alert).toHaveTextContent('6 s');
  });
});
