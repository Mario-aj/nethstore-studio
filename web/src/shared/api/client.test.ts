import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorMessage, t } from '../i18n/pt-AO';
import { ApiError, request } from './client';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const okSchema = z.object({ status: z.literal('ok') });

describe('request', () => {
  it('parses and validates JSON', async () => {
    server.use(http.get('*/api/health', () => HttpResponse.json({ status: 'ok', extra: 1 })));
    await expect(request('/api/health', { schema: okSchema })).resolves.toEqual({ status: 'ok' });
  });

  it('fails with invalid_response when the body does not match', async () => {
    server.use(http.get('*/api/health', () => HttpResponse.json({ status: 'down' })));
    await expect(request('/api/health', { schema: okSchema })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('sends JSON with Content-Type only when there is a body', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.post('*/api/x', ({ request: req }) => {
        seen.push(req.headers.get('content-type'));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await request('/api/x', { method: 'POST', body: { a: 1 } });
    await request('/api/x', { method: 'POST' });
    expect(seen).toEqual(['application/json', null]);
  });

  it('maps the error body to code and details', async () => {
    server.use(
      http.post('*/api/auth/login', () =>
        HttpResponse.json(
          { error: { code: 'invalid_secret', message: 'nope', remainingAttempts: 2 } },
          { status: 401 },
        ),
      ),
    );
    const error = (await request('/api/auth/login', { method: 'POST', body: { secret: 'x' } }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe('invalid_secret');
    expect(error.details.remainingAttempts).toBe(2);
  });

  it('reads Retry-After when the body has no retryAfterSeconds', async () => {
    server.use(
      http.post('*/api/auth/login', () =>
        HttpResponse.json(
          { error: { code: 'too_many_attempts' } },
          { status: 429, headers: { 'Retry-After': '120' } },
        ),
      ),
    );
    await expect(request('/api/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'too_many_attempts',
      details: { retryAfterSeconds: 120 },
    });
  });

  it('keeps a generic code when the error is not JSON', async () => {
    server.use(http.get('*/api/x', () => new HttpResponse('<html>bad gateway</html>', { status: 502 })));
    await expect(request('/api/x')).rejects.toMatchObject({ status: 502, code: 'http_502' });
  });

  it('turns a failed connection into a network error', async () => {
    server.use(http.get('*/api/x', () => HttpResponse.error()));
    const error = (await request('/api/x').catch((e: unknown) => e)) as ApiError;
    expect(error.isNetwork).toBe(true);
    expect(error.code).toBe('network');
  });
});

describe('error messages', () => {
  // Every code in docs/DECISOES.md has a pt-AO translation.
  const codes = [
    'invalid_json',
    'invalid_format',
    'invalid_price',
    'invalid_sizes',
    'invalid_description',
    'invalid_photo_count',
    'invalid_id',
    'unauthenticated',
    'invalid_secret',
    'forbidden_origin',
    'not_found',
    'not_ready',
    'method_not_allowed',
    'object_missing',
    'invalid_object_size',
    'invalid_state',
    'payload_too_large',
    'unsupported_media_type',
    'too_many_attempts',
    'too_many_open_batches',
    'internal',
    'storage_unavailable',
    'network',
  ];

  it.each(codes)('%s has its own message', (code) => {
    expect(errorMessage(code)).not.toBe(t.errors.unknown);
  });

  it('falls back for unknown codes', () => {
    expect(errorMessage('something_new')).toBe(t.errors.unknown);
  });
});
