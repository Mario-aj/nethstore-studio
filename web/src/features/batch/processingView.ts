// Pure derivation of what the Processamento / Pronto screens show, from the batch
// returned by the API plus the local upload manager (which knows about uploads the
// server has not registered yet, and about the network pause).

import type { Batch, BatchPhoto, FailedStep, PhotoStatus, StepState } from '../../shared/api/schemas';
import { deployText, t, type DeployMode } from '../../shared/i18n/pt-AO';
import type { BatchUploadView } from './uploadManager';

export type StepKey = 'upload' | 'prepare' | 'stamp' | 'ready';
export const STEP_KEYS: readonly StepKey[] = ['upload', 'prepare', 'stamp', 'ready'];
const PIPELINE: readonly Exclude<StepKey, 'ready'>[] = ['upload', 'prepare', 'stamp'];

export interface EffectivePhoto {
  id: string;
  position: number;
  status: PhotoStatus;
  failedStep: FailedStep | null;
  errorCode: string | null;
  /** The upload manager still has the file, so an upload failure can be retried in place. */
  hasLocalFile: boolean;
}

export interface StepResult {
  state: StepState;
  done: number;
  total: number;
  failed: number;
}

export type Steps = Record<StepKey, StepResult>;

/** Merges the server status with what the upload manager knows locally. */
export function effectivePhotos(batch: Batch, uploads: BatchUploadView | undefined): EffectivePhoto[] {
  const local = new Map(uploads?.items.map((item) => [item.photoId, item]));
  return [...batch.photos]
    .sort((a, b) => a.position - b.position)
    .map((photo: BatchPhoto) => {
      const item = local.get(photo.id);
      let { status, failedStep, errorCode } = photo;
      if (status === 'awaiting_upload' && item?.state === 'done') status = 'uploaded';
      if (status === 'awaiting_upload' && item?.state === 'failed') {
        status = 'failed';
        failedStep = 'upload';
        errorCode = 'upload_failed';
      }
      if (
        status === 'failed' &&
        failedStep === 'upload' &&
        (item?.state === 'queued' || item?.state === 'working')
      ) {
        status = 'awaiting_upload';
        failedStep = null;
        errorCode = null;
      }
      return {
        id: photo.id,
        position: photo.position,
        status,
        failedStep,
        errorCode,
        hasLocalFile: item?.hasFile ?? false,
      };
    });
}

/** Index of the pipeline step a photo is in (3 = past all), or where it failed. */
function stageOf(photo: Pick<EffectivePhoto, 'status' | 'failedStep'>): { stage: number; failed: boolean } {
  switch (photo.status) {
    case 'awaiting_upload':
      return { stage: 0, failed: false };
    case 'uploaded':
      return { stage: 1, failed: false };
    case 'prepared':
      return { stage: 2, failed: false };
    case 'stamped':
      return { stage: 3, failed: false };
    case 'failed':
      return { stage: PIPELINE.indexOf(photo.failedStep ?? 'upload'), failed: true };
  }
}

export function isInProgress(photo: Pick<EffectivePhoto, 'status'>): boolean {
  return photo.status === 'awaiting_upload' || photo.status === 'uploaded' || photo.status === 'prepared';
}

/** Step states with the rules of SPEC 7.3 and docs/DECISOES.md (same as the API). */
export function computeSteps(photos: readonly Pick<EffectivePhoto, 'status' | 'failedStep'>[]): Steps {
  const total = photos.length;
  const stages = photos.map(stageOf);
  const result = {} as Steps;

  PIPELINE.forEach((key, index) => {
    // passed: went past the step (failing later still counts as passing this one).
    const passed = stages.filter((s) => s.stage > index).length;
    const failed = stages.filter((s) => s.failed && s.stage === index).length;
    // On the way to the step or inside it.
    const inOrBefore = stages.filter((s) => !s.failed && s.stage <= index).length;
    // Got to the step at some point. Zero here implies the previous step is unfinished.
    const reached = stages.filter((s) => s.stage >= index).length;

    let state: StepState;
    if (inOrBefore > 0) state = reached === 0 ? 'pending' : 'loading';
    else state = failed > 0 ? 'error' : 'completed';

    result[key] = { state, done: passed, total, failed };
  });

  const stamped = photos.filter((p) => p.status === 'stamped').length;
  const finished = !photos.some(isInProgress);
  result.ready = {
    state: finished ? (stamped > 0 ? 'completed' : 'error') : 'pending',
    done: finished ? stamped : 0,
    total,
    failed: 0,
  };
  return result;
}

export type Phase = 'uploading' | 'offline' | 'preparing' | 'stamping' | 'failed' | 'done';

export interface StepRow {
  key: StepKey;
  label: string;
  state: StepState;
  count: string;
}

export interface ProcessingView {
  phase: Phase;
  pct: number;
  ringPaused: boolean;
  caption: string;
  title: string;
  message: { tone: 'calm' | 'warn'; text: string } | null;
  steps: StepRow[];
  photos: EffectivePhoto[];
  ready: EffectivePhoto[];
  failed: EffectivePhoto[];
  total: number;
  finished: boolean;
}

interface ViewInput {
  batch: Batch;
  uploads: BatchUploadView | undefined;
  paused: boolean;
  mode: DeployMode;
  /** The user tapped "Seguir com N": show Pronto even with failures. */
  accepted: boolean;
}

export function processingView({ batch, uploads, paused, mode, accepted }: ViewInput): ProcessingView {
  const photos = effectivePhotos(batch, uploads);
  const total = photos.length;
  const steps = computeSteps(photos);
  const ready = photos.filter((p) => p.status === 'stamped');
  const failed = photos.filter((p) => p.status === 'failed');
  const finished = !photos.some(isInProgress);
  const text = deployText(mode);

  const uploading = steps.upload.state === 'loading';
  const offline = paused && uploading;

  // Smooth ring while uploading: count partial progress of photos in flight.
  const inFlight =
    uploads?.items.filter((i) => i.state === 'working').reduce((sum, i) => sum + i.progress, 0) ?? 0;
  const uploadPct = total === 0 ? 0 : ((steps.upload.done + (offline ? 0 : inFlight)) / total) * 100;
  const stampPct = total === 0 ? 0 : (ready.length / total) * 100;

  let phase: Phase;
  if (offline) phase = 'offline';
  else if (uploading) phase = 'uploading';
  else if (!finished) phase = steps.stamp.state === 'pending' ? 'preparing' : 'stamping';
  else if (failed.length > 0 && !accepted) phase = 'failed';
  else phase = 'done';

  const pct = phase === 'uploading' || phase === 'offline' ? uploadPct : stampPct;
  const caption =
    phase === 'offline'
      ? t.processing.paused
      : phase === 'uploading'
        ? t.processing.count(steps.upload.done, total)
        : t.processing.count(ready.length, total);

  let title: string;
  let message: ProcessingView['message'] = null;
  switch (phase) {
    case 'offline':
      title = t.processing.titleOffline;
      break;
    case 'uploading':
      title = t.processing.titleUploading;
      message = { tone: 'warn', text: t.processing.msgUploading };
      break;
    case 'preparing':
      title = t.processing.titlePreparing;
      message = { tone: 'calm', text: text.processingCalm };
      break;
    case 'stamping':
      title = t.processing.titleStamping;
      message = { tone: 'calm', text: text.processingCalm };
      break;
    case 'failed':
      title =
        ready.length === 0
          ? t.processing.titleAllFailed
          : failed.length === 1
            ? t.processing.titleOneFailed
            : t.processing.titleSomeFailed(failed.length);
      message = {
        tone: 'calm',
        text: ready.length === 0 ? t.processing.msgNoneReady : t.processing.msgOthersReady(ready.length),
      };
      break;
    case 'done':
      title = t.ready.title;
      break;
  }

  const rows: StepRow[] = STEP_KEYS.map((key) => {
    const step = steps[key];
    let state = step.state;
    let count = `${step.done}/${step.total}`;
    if (key === 'upload' && offline) {
      state = 'error';
      count = t.processing.countPaused(step.done, step.total);
    } else if (step.state === 'error' && key !== 'ready') {
      count = t.processing.countFailed(step.done, step.total, step.failed);
    }
    if (key === 'ready' && phase === 'failed') {
      // Waiting for the choice between "Seguir com N" and "Repetir".
      state = 'pending';
      count = `0/${step.total}`;
    }
    return { key, label: t.processing.steps[key], state, count };
  });

  return {
    phase,
    pct,
    ringPaused: phase === 'offline',
    caption,
    title,
    message,
    steps: rows,
    photos,
    ready,
    failed,
    total,
    finished,
  };
}
