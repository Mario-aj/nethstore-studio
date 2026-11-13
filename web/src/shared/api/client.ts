import type { z } from 'zod';
import { errorBodySchema } from './schemas';

export interface ApiErrorDetails {
  remainingAttempts?: number;
  retryAfterSeconds?: number;
}

/** Error with a stable code. `status` 0 and code `network` mean no answer at all. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetails;

  constructor(status: number, code: string, details: ApiErrorDetails = {}) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

interface RequestOptions<S extends z.ZodType | undefined> {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  schema?: S;
  signal?: AbortSignal;
}

type Result<S> = S extends z.ZodType ? z.infer<S> : undefined;

function retryAfterFrom(res: Response, bodyValue: number | undefined): number | undefined {
  if (bodyValue !== undefined) return bodyValue;
  const header = res.headers.get('Retry-After');
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds : undefined;
}

async function errorFrom(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`;
  let details: ApiErrorDetails = {};
  try {
    const parsed = errorBodySchema.safeParse(await res.json());
    if (parsed.success) {
      code = parsed.data.error.code;
      details = {
        remainingAttempts: parsed.data.error.remainingAttempts,
        retryAfterSeconds: parsed.data.error.retryAfterSeconds,
      };
    }
  } catch {
    // Body was not JSON (for example a proxy error page). Keep the generic code.
  }
  const retryAfterSeconds = retryAfterFrom(res, details.retryAfterSeconds);
  if (retryAfterSeconds !== undefined) details.retryAfterSeconds = retryAfterSeconds;
  if (details.remainingAttempts === undefined) delete details.remainingAttempts;
  return new ApiError(res.status, code, details);
}

/**
 * JSON request against the same-origin API. The browser adds the Origin header
 * on POST/DELETE; Content-Type is only sent when there is a body (SPEC 7).
 */
export async function request<S extends z.ZodType | undefined = undefined>(
  path: string,
  { method = 'GET', body, schema, signal }: RequestOptions<S> = {},
): Promise<Result<S>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'network');
  }

  if (!res.ok) throw await errorFrom(res);
  if (schema === undefined || res.status === 204) return undefined as Result<S>;

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, 'invalid_response');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiError(res.status, 'invalid_response');
  return parsed.data as Result<S>;
}
