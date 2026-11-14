// Fake API for `pnpm dev:mock` (visual work without the Go stack). Never shipped:
// only imported when import.meta.env.MODE === 'mock'.
//
// Pick a scenario with ?cenario=<name> (remembered in localStorage):
//   (none)       everything works and the batch ends in "Pronto"
//   desligado    /api/health fails (Entrada "computador fora de alcance")
//   errada       login answers 401 with 2 attempts left
//   bloqueada    login answers 429, 4:59 to wait
//   verificar    login never answers ("A verificar")
//   publico      deploy mode "public" (neutral copy)
//   enviar       3 uploads go through, the rest hang ("A enviar")
//   sem-ligacao  3 uploads go through, then the network drops ("Sem ligação")
//   aplicar      processing stops at 7 of 12 with one failure ("A aplicar")
//   erro         the last photo fails in the stamp step ("Uma foto falhou")

import { delay, http, HttpResponse } from 'msw';
import beige from '../assets/photos/beige-dress-480.webp';
import blue from '../assets/photos/blue-set-480.webp';
import magenta from '../assets/photos/magenta-blouse-480.webp';
import orange from '../assets/photos/orange-set-480.webp';
import polka from '../assets/photos/polka-dress-480.webp';
import { stampLines } from '../shared/lib/stamp';

const THUMBS = [orange, beige, blue, polka, magenta];

/** The only key the fake API accepts (the example key of SPEC 7.2). */
export const MOCK_SECRET = 'k7Qm2xVb9Lp4TzR8nWc1Hs6YdJ3fGa5E';

export function scenario(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('cenario');
  if (fromUrl !== null) localStorage.setItem('mock:cenario', fromUrl);
  return localStorage.getItem('mock:cenario') ?? '';
}

// Remember the scenario of the URL the app was opened with (later URLs drop the query).
scenario();

interface MockPhoto {
  id: string;
  position: number;
  uploadedAt: number | null;
  failedStep: 'upload' | 'prepare' | 'stamp' | null;
  errorCode: string | null;
  retriedAt: number | null;
}

interface MockBatch {
  id: string;
  seq: number;
  priceKz: number;
  sizes: string[];
  description: string | null;
  createdAt: string;
  photos: MockPhoto[];
}

const state = {
  loggedIn: localStorage.getItem('mock:session') === '1',
  batches: new Map<string, MockBatch>(),
  seq: 6,
  uploads: 0,
};

const uuid = () => crypto.randomUUID();

function slot(batchId: string, photoId: string) {
  return {
    url: '/s3/estudio',
    fields: {
      key: `originals/${batchId}/${photoId}.jpg`,
      'Content-Type': 'image/jpeg',
      'x-amz-algorithm': 'AWS4-HMAC-SHA256',
      'x-amz-credential': 'GKmock/20261113/garage/s3/aws4_request',
      'x-amz-date': '20261113T190000Z',
      policy: 'bW9jaw==',
      'x-amz-signature': 'mock',
    },
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
}

type Status = 'awaiting_upload' | 'uploaded' | 'prepared' | 'stamped' | 'failed';

function statusOf(
  photo: MockPhoto,
  now: number,
  total: number,
): { status: Status; failedStep: MockPhoto['failedStep']; errorCode: string | null } {
  if (photo.failedStep) return { status: 'failed', failedStep: photo.failedStep, errorCode: photo.errorCode };
  if (photo.uploadedAt === null) return { status: 'awaiting_upload', failedStep: null, errorCode: null };
  const start = photo.retriedAt ?? photo.uploadedAt;
  const prepared = start + 500 + photo.position * 120;
  const stamped = prepared + 600;
  const cenario = scenario();
  if (cenario === 'aplicar' && photo.retriedAt === null) {
    if (photo.position === 8)
      return { status: 'failed', failedStep: 'stamp', errorCode: 'processing_failed' };
    if (photo.position > 8)
      return { status: now >= prepared ? 'prepared' : 'uploaded', failedStep: null, errorCode: null };
  }
  if (now < prepared) return { status: 'uploaded', failedStep: null, errorCode: null };
  if (now < stamped) return { status: 'prepared', failedStep: null, errorCode: null };
  if (cenario === 'erro' && photo.position === total && photo.retriedAt === null) {
    return { status: 'failed', failedStep: 'stamp', errorCode: 'processing_failed' };
  }
  return { status: 'stamped', failedStep: null, errorCode: null };
}

function batchJson(batch: MockBatch) {
  const now = Date.now();
  const total = batch.photos.length;
  const photos = batch.photos.map((p) => ({ id: p.id, position: p.position, ...statusOf(p, now, total) }));
  const lines = stampLines(batch);
  const count = (s: Status) => photos.filter((p) => p.status === s).length;
  const inProgress = count('awaiting_upload') + count('uploaded') + count('prepared');
  return {
    id: batch.id,
    seq: batch.seq,
    priceKz: batch.priceKz,
    sizes: batch.sizes,
    description: batch.description,
    stampLine1: lines.line1,
    stampLine2: lines.line2,
    createdAt: batch.createdAt,
    photoCount: total,
    // The real API computes these; the app recomputes them from `photos` anyway.
    steps: {
      upload: { state: 'loading', done: 0, total },
      prepare: { state: 'pending', done: 0, total },
      stamp: { state: 'pending', done: 0, total },
      ready: { state: 'pending' },
    },
    failedCount: count('failed'),
    finished: inProgress === 0,
    photos: photos.map((p) => ({
      id: p.id,
      position: p.position,
      status: p.status,
      failedStep: p.failedStep,
      errorCode: p.errorCode,
    })),
  };
}

function findPhoto(id: string): { batch: MockBatch; photo: MockPhoto } | null {
  for (const batch of state.batches.values()) {
    const photo = batch.photos.find((p) => p.id === id);
    if (photo) return { batch, photo };
  }
  return null;
}

const unauthenticated = () =>
  HttpResponse.json({ error: { code: 'unauthenticated', message: 'no session' } }, { status: 401 });

export const handlers = [
  http.get('/api/health', () =>
    scenario() === 'desligado' ? HttpResponse.error() : HttpResponse.json({ status: 'ok' }),
  ),

  http.get('/api/config', () =>
    HttpResponse.json({ deployMode: scenario() === 'publico' ? 'public' : 'lan' }),
  ),

  http.get('/api/auth/me', () =>
    state.loggedIn
      ? HttpResponse.json({ authenticated: true, expiresAt: new Date(Date.now() + 30 * 864e5).toISOString() })
      : unauthenticated(),
  ),

  http.post('/api/auth/login', async ({ request }) => {
    const { secret } = (await request.json()) as { secret: string };
    await delay(600);
    const cenario = scenario();
    if (cenario === 'verificar') await delay('infinite');
    if (cenario === 'errada') {
      return HttpResponse.json(
        { error: { code: 'invalid_secret', message: 'wrong', remainingAttempts: 2 } },
        { status: 401 },
      );
    }
    if (cenario === 'bloqueada') {
      return HttpResponse.json(
        { error: { code: 'too_many_attempts', message: 'locked', retryAfterSeconds: 299 } },
        { status: 429, headers: { 'Retry-After': '299' } },
      );
    }
    if (!/^[0-9A-Za-z]{32}$/.test(secret))
      return HttpResponse.json({ error: { code: 'invalid_format' } }, { status: 400 });
    if (secret !== MOCK_SECRET) {
      return HttpResponse.json(
        { error: { code: 'invalid_secret', message: 'wrong', remainingAttempts: 4 } },
        { status: 401 },
      );
    }
    state.loggedIn = true;
    localStorage.setItem('mock:session', '1');
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/auth/logout', () => {
    state.loggedIn = false;
    localStorage.removeItem('mock:session');
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/batches', async ({ request }) => {
    if (!state.loggedIn) return unauthenticated();
    const body = (await request.json()) as {
      priceKz: number;
      sizes: string[];
      description: string | null;
      photoCount: number;
    };
    await delay(300);
    const id = uuid();
    state.seq += 1;
    state.uploads = 0;
    const batch: MockBatch = {
      id,
      seq: state.seq,
      priceKz: body.priceKz,
      sizes: body.sizes,
      description: body.description,
      createdAt: new Date().toISOString(),
      photos: Array.from({ length: body.photoCount }, (_, i) => ({
        id: uuid(),
        position: i + 1,
        uploadedAt: null,
        failedStep: null,
        errorCode: null,
        retriedAt: null,
      })),
    };
    state.batches.set(id, batch);
    const lines = stampLines(batch);
    return HttpResponse.json(
      {
        id,
        seq: batch.seq,
        stampLine1: lines.line1,
        stampLine2: lines.line2,
        photos: batch.photos.map((p) => ({ id: p.id, position: p.position, upload: slot(id, p.id) })),
      },
      { status: 201 },
    );
  }),

  http.get('/api/batches/:id', ({ params }) => {
    if (!state.loggedIn) return unauthenticated();
    const batch = state.batches.get(String(params.id));
    if (!batch) return HttpResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    return HttpResponse.json(batchJson(batch));
  }),

  http.delete('/api/batches/:id', async ({ params }) => {
    if (!state.loggedIn) return unauthenticated();
    await delay(300);
    if (!state.batches.delete(String(params.id))) {
      return HttpResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/s3/estudio', async () => {
    state.uploads += 1;
    const n = state.uploads;
    const cenario = scenario();
    await delay(250 + Math.random() * 250);
    if ((cenario === 'enviar' || cenario === 'sem-ligacao') && n > 3) {
      if (cenario === 'enviar') await delay('infinite');
      return HttpResponse.error();
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/photos/:id/uploaded', ({ params }) => {
    const found = findPhoto(String(params.id));
    if (!found) return HttpResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    found.photo.uploadedAt = Date.now();
    return new HttpResponse(null, { status: 202 });
  }),

  http.post('/api/photos/:id/upload-slot', ({ params }) => {
    const found = findPhoto(String(params.id));
    if (!found) return HttpResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    found.photo.failedStep = null;
    found.photo.errorCode = null;
    return HttpResponse.json(slot(found.batch.id, found.photo.id));
  }),

  http.post('/api/photos/:id/upload-failed', ({ params }) => {
    const found = findPhoto(String(params.id));
    if (!found) return HttpResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    found.photo.failedStep = 'upload';
    found.photo.errorCode = 'upload_failed';
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/photos/:id/retry', ({ params }) => {
    const found = findPhoto(String(params.id));
    if (!found) return HttpResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    found.photo.failedStep = null;
    found.photo.errorCode = null;
    found.photo.retriedAt = Date.now();
    return new HttpResponse(null, { status: 202 });
  }),

  http.get('/api/photos/:id/:kind', async ({ params }) => {
    const found = findPhoto(String(params.id));
    if (!found) return HttpResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    const image = await fetch(THUMBS[(found.photo.position - 1) % THUMBS.length] ?? orange);
    const name = `nethstore-${String(found.batch.seq).padStart(3, '0')}-${String(found.photo.position).padStart(3, '0')}.jpg`;
    return new HttpResponse(await image.arrayBuffer(), {
      headers: {
        'Content-Type': 'image/webp',
        ...(params.kind === 'stamped' ? { 'Content-Disposition': `attachment; filename="${name}"` } : {}),
      },
    });
  }),
];
