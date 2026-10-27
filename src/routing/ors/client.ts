/** openrouteservice, hosted by HeiGIT. The old api.openrouteservice.org host shuts down in November 2026. */
export const ORS_BASE = 'https://api.heigit.org/openrouteservice';

export interface Quota {
  remaining: number;
  /** When the quota resets (epoch ms), if the server said. */
  resetAt: number | null;
  /** When we read it (epoch ms). */
  seenAt: number;
}

export type OrsErrorKind =
  | 'auth' // key missing or rejected
  | 'quota' // daily limit reached
  | 'rate' // per-minute limit: wait and retry
  | 'too-big' // 6004: more routes than allowed
  | 'out-of-bounds' // 6010: a point outside the routing graph
  | 'too-far' // 6020/6099: search gave up (very long or awkward routes)
  | 'server' // 5xx: retry later
  | 'network' // no connection
  | 'other';

export class OrsError extends Error {
  constructor(
    readonly kind: OrsErrorKind,
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly quota: Quota | null = null,
  ) {
    super(message);
    this.name = 'OrsError';
  }
}

/** Reads the rate-limit headers. `x-ratelimit-reset` may be epoch seconds or seconds from now. */
export function readQuota(h: Headers, now = Date.now()): Quota | null {
  const rem = h.get('x-ratelimit-remaining');
  if (rem === null || rem === '') return null;
  const remaining = Number(rem);
  if (!Number.isFinite(remaining)) return null;
  const r = Number(h.get('x-ratelimit-reset'));
  const resetAt = Number.isFinite(r) && r > 0 ? (r > 1e12 ? r : r > 1e9 ? r * 1000 : now + r * 1000) : null;
  return { remaining, resetAt, seenAt: now };
}

function classify(status: number, code: number | undefined, message: string, quota: Quota | null): OrsErrorKind {
  if (status === 401) return 'auth';
  if (status === 429) return 'rate';
  if (status === 403) return quota?.remaining === 0 || /quota|limit/i.test(message) ? 'quota' : 'auth';
  if (code === 6004) return 'too-big';
  if (code === 6010) return 'out-of-bounds';
  if (code === 6020 || code === 6099) return 'too-far';
  if (status >= 500) return 'server';
  return 'other';
}

export interface OrsResult<T> {
  data: T;
  quota: Quota | null;
}

/** POST to ORS with the user's key. Throws OrsError, classified so the scheduler knows what to do. */
export async function orsPost<T>(path: string, body: unknown, key: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<OrsResult<T>> {
  let res: Response;
  try {
    res = await fetchImpl(`${ORS_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new OrsError('network', 'Can’t reach openrouteservice. Check your connection.', 0);
  }
  const quota = readQuota(res.headers);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  if (res.ok) return { data: json as T, quota };
  const err = (json as { error?: unknown; message?: unknown } | null)?.error ?? (json as { message?: unknown } | null)?.message;
  const code = typeof err === 'object' && err !== null ? Number((err as { code?: unknown }).code) : undefined;
  const message = typeof err === 'string' ? err : typeof err === 'object' && err !== null ? String((err as { message?: unknown }).message ?? '') : res.statusText;
  throw new OrsError(classify(res.status, Number.isFinite(code) ? code : undefined, message, quota), message || `HTTP ${res.status}`, res.status, Number.isFinite(code) ? code : undefined, quota);
}
