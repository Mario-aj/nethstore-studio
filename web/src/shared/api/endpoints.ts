import { request } from './client';
import {
  batchPageSchema,
  batchSchema,
  configSchema,
  createdBatchSchema,
  healthSchema,
  meSchema,
  uploadSlotSchema,
  type Batch,
  type BatchPage,
  type CreatedBatch,
  type Me,
  type AppConfig,
  type UploadSlot,
} from './schemas';

export const api = {
  health: () => request('/api/health', { schema: healthSchema }),
  config: (): Promise<AppConfig> => request('/api/config', { schema: configSchema }),
  me: (): Promise<Me> => request('/api/auth/me', { schema: meSchema }),
  login: (secret: string) => request('/api/auth/login', { method: 'POST', body: { secret } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  createBatch: (input: {
    priceKz: number;
    sizes: string[];
    description: string | null;
    photoCount: number;
  }): Promise<CreatedBatch> =>
    request('/api/batches', { method: 'POST', body: input, schema: createdBatchSchema }),
  /** Newest first; `before` is the `nextBefore` of the previous page. */
  batches: (
    { limit, before }: { limit: number; before?: number },
    signal?: AbortSignal,
  ): Promise<BatchPage> =>
    request(`/api/batches?limit=${limit}${before ? `&before=${before}` : ''}`, {
      schema: batchPageSchema,
      signal,
    }),
  batch: (id: string, signal?: AbortSignal): Promise<Batch> =>
    request(`/api/batches/${encodeURIComponent(id)}`, { schema: batchSchema, signal }),
  deleteBatch: (id: string) => request(`/api/batches/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  confirmUploaded: (photoId: string) =>
    request(`/api/photos/${encodeURIComponent(photoId)}/uploaded`, { method: 'POST' }),
  uploadSlot: (photoId: string): Promise<UploadSlot> =>
    request(`/api/photos/${encodeURIComponent(photoId)}/upload-slot`, {
      method: 'POST',
      schema: uploadSlotSchema,
    }),
  uploadFailed: (photoId: string) =>
    request(`/api/photos/${encodeURIComponent(photoId)}/upload-failed`, { method: 'POST' }),
  retryPhoto: (photoId: string) =>
    request(`/api/photos/${encodeURIComponent(photoId)}/retry`, { method: 'POST' }),
};

export const photoUrls = {
  thumb: (photoId: string) => `/api/photos/${encodeURIComponent(photoId)}/thumb`,
  stamped: (photoId: string) => `/api/photos/${encodeURIComponent(photoId)}/stamped`,
};

export const queryKeys = {
  health: ['health'] as const,
  config: ['config'] as const,
  me: ['me'] as const,
  batches: ['batches'] as const,
  batch: (id: string) => ['batch', id] as const,
};
