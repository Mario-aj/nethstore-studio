import { z } from 'zod';

// Every API response is validated against these schemas (SPEC 3, docs/DECISOES.md).
// Unknown keys are stripped, missing or mistyped keys fail loudly.

export const healthSchema = z.object({ status: z.literal('ok') });

export const configSchema = z.object({ deployMode: z.enum(['lan', 'public']) });
export type AppConfig = z.infer<typeof configSchema>;

export const meSchema = z.object({ authenticated: z.literal(true), expiresAt: z.string() });
export type Me = z.infer<typeof meSchema>;

export const uploadSlotSchema = z.object({
  url: z.string().startsWith('/'),
  fields: z.record(z.string(), z.string()),
  expiresAt: z.string(),
});
export type UploadSlot = z.infer<typeof uploadSlotSchema>;

export const createdBatchSchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  stampLine1: z.string(),
  stampLine2: z.string(),
  photos: z.array(z.object({ id: z.string(), position: z.number().int(), upload: uploadSlotSchema })),
});
export type CreatedBatch = z.infer<typeof createdBatchSchema>;

export const stepStateSchema = z.enum(['pending', 'loading', 'completed', 'error']);
export type StepState = z.infer<typeof stepStateSchema>;

const stepSchema = z.object({
  state: stepStateSchema,
  done: z.number().int().optional(),
  total: z.number().int().optional(),
});

export const photoStatusSchema = z.enum(['awaiting_upload', 'uploaded', 'prepared', 'stamped', 'failed']);
export type PhotoStatus = z.infer<typeof photoStatusSchema>;

export const failedStepSchema = z.enum(['upload', 'prepare', 'stamp']);
export type FailedStep = z.infer<typeof failedStepSchema>;

export const batchPhotoSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  status: photoStatusSchema,
  failedStep: failedStepSchema.nullable(),
  errorCode: z.string().nullable(),
});
export type BatchPhoto = z.infer<typeof batchPhotoSchema>;

export const batchSchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  priceKz: z.number().int(),
  sizes: z.array(z.string()),
  description: z.string().nullable(),
  stampLine1: z.string(),
  stampLine2: z.string(),
  createdAt: z.string(),
  photoCount: z.number().int().optional(),
  steps: z.object({ upload: stepSchema, prepare: stepSchema, stamp: stepSchema, ready: stepSchema }),
  failedCount: z.number().int(),
  finished: z.boolean(),
  photos: z.array(batchPhotoSchema),
});
export type Batch = z.infer<typeof batchSchema>;

// GET /api/batches (DECISOES.md, "Acréscimos ao contrato da API").
export const batchSummarySchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  priceKz: z.number().int(),
  sizes: z.array(z.string()),
  description: z.string().nullable(),
  stampLine1: z.string(),
  stampLine2: z.string(),
  photoCount: z.number().int(),
  stampedCount: z.number().int(),
  failedCount: z.number().int(),
  finished: z.boolean(),
  createdAt: z.string(),
  coverPhotoId: z.string().nullable(),
});
export type BatchSummary = z.infer<typeof batchSummarySchema>;

export const batchPageSchema = z.object({
  batches: z.array(batchSummarySchema),
  nextBefore: z.number().int().nullable(),
});
export type BatchPage = z.infer<typeof batchPageSchema>;

export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
    remainingAttempts: z.number().int().optional(),
    retryAfterSeconds: z.number().optional(),
  }),
});
