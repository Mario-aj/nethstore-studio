import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { renderAt } from '../../test/render';
import { LoginPage } from './LoginPage';

const KEY = 'k7Qm2xVb9Lp4TzR8nWc1Hs6YdJ3fGa5E';
const server = setupServer(
  http.get('*/api/health', () => HttpResponse.json({ status: 'ok' })),
  http.get('*/api/config', () => HttpResponse.json({ deployMode: 'lan' })),
  http.get('*/api/auth/me', () => HttpResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 })),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const field = () => screen.getByLabelText('Chave de acesso');
const enter = () => screen.getByRole('button', { name: /Entrar|A verificar|Tenta em/ });

describe('LoginPage', () => {
  it('enables Entrar only with 32 characters and shows the counter', async () => {
    const user = userEvent.setup();
    renderAt(<LoginPage />, { path: '/entrar' });
    expect(await screen.findByText('Ligado')).toBeInTheDocument();
    expect(screen.getByText('0/32')).toBeInTheDocument();
    expect(enter()).toBeDisabled();
    await user.type(field(), KEY.slice(0, 18));
    expect(screen.getByText('Faltam 14 caracteres.')).toBeInTheDocument();
    expect(enter()).toBeDisabled();
    await user.type(field(), KEY.slice(18));
    expect(screen.getByText('32/32')).toBeInTheDocument();
    expect(enter()).toBeEnabled();
    expect(field()).toHaveAttribute('type', 'password');
    expect(field()).toHaveAttribute('autocomplete', 'current-password');
    expect(field()).toHaveAttribute('maxlength', '32');
  });

  it('shows the wrong key message with the attempts left', async () => {
    server.use(
      http.post('*/api/auth/login', () =>
        HttpResponse.json({ error: { code: 'invalid_secret', remainingAttempts: 2 } }, { status: 401 }),
      ),
    );
    const user = userEvent.setup();
    renderAt(<LoginPage />, { path: '/entrar' });
    await user.type(field(), KEY);
    await user.click(enter());
    expect(await screen.findByText('Chave errada. Restam 2 tentativas.')).toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
  });

  it('locks with a countdown on 429', async () => {
    server.use(
      http.post('*/api/auth/login', () =>
        HttpResponse.json(
          { error: { code: 'too_many_attempts', retryAfterSeconds: 299 } },
          { status: 429, headers: { 'Retry-After': '299' } },
        ),
      ),
    );
    const user = userEvent.setup();
    renderAt(<LoginPage />, { path: '/entrar' });
    await user.type(field(), KEY);
    await user.click(enter());
    expect(await screen.findByText('Muitas tentativas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tenta em 4:5\d/ })).toBeDisabled();
    expect(field()).toBeDisabled();
  });

  it('shows Desligado and the reconnect button when the computer does not answer', async () => {
    server.use(http.get('*/api/health', () => HttpResponse.error()));
    renderAt(<LoginPage />, { path: '/entrar' });
    expect(await screen.findByText('Desligado')).toBeInTheDocument();
    expect(screen.getByText('Computador fora de alcance')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tentar ligar outra vez/ })).toBeInTheDocument();
  });

  it('logs in and goes to the safe next path', async () => {
    let loggedIn = false;
    server.use(
      http.post('*/api/auth/login', async ({ request }) => {
        expect(await request.json()).toEqual({ secret: KEY });
        loggedIn = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get('*/api/auth/me', () =>
        loggedIn
          ? HttpResponse.json({ authenticated: true, expiresAt: '2026-12-13T19:00:00Z' })
          : HttpResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 }),
      ),
    );
    const user = userEvent.setup();
    renderAt(<LoginPage />, { path: '/entrar?next=%2Festudio%2Flotes%2Fabc', route: '/entrar' });
    await user.type(field(), KEY);
    await user.click(enter());
    await waitFor(() =>
      expect(screen.getAllByTestId('location').at(-1)).toHaveTextContent('/estudio/lotes/abc'),
    );
  });
});
