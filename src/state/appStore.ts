import { createStore } from 'zustand/vanilla';
import type { Quota } from '../routing/ors/client';
import { loadJSON, removeKey, saveJSON } from './persist';

/** What the background fetching is doing, for the progress chip. */
export interface JobStatus {
  state: 'idle' | 'loading' | 'running' | 'confirm' | 'declined' | 'waiting' | 'paused-quota' | 'auth' | 'offline' | 'error';
  /** Requests still to go, and done, in the current batch. */
  todo: number;
  done: number;
  failed: number;
  /** When waiting or paused: until when (epoch ms). */
  until?: number;
  message?: string;
  /** Asked before a big batch. */
  confirm?: { requests: number; minutes: number; remaining: number | null };
  /** Fields the router can't reach, by spec key → reason ('no-road' | 'unreachable'). */
  failures?: Record<string, string>;
}

interface AppState {
  /** The user's openrouteservice key. Never exported, never sent anywhere but api.heigit.org. */
  key: string | null;
  remember: boolean;
  quota: { matrix?: Quota; snap?: Quota; geocode?: Quota };
  /** Learned from a 6004: the most points one matrix request may hold. */
  maxChunk: number;
  job: JobStatus;
}

const KEY_STORAGE = 'w2l.key';
const APP = 'w2l.app';

function loadKey(): { key: string | null; remember: boolean } {
  try {
    const remembered = globalThis.localStorage?.getItem(KEY_STORAGE);
    if (remembered) return { key: remembered, remember: true };
    const session = globalThis.sessionStorage?.getItem(KEY_STORAGE);
    if (session) return { key: session, remember: false };
  } catch {
    /* storage unavailable */
  }
  return { key: null, remember: true };
}

const saved = loadJSON<{ quota?: AppState['quota']; maxChunk?: number }>(APP);

export const appStore = createStore<AppState>(() => ({
  ...loadKey(),
  quota: saved?.quota ?? {},
  maxChunk: saved?.maxChunk ?? 3400,
  job: { state: 'idle', todo: 0, done: 0, failed: 0 },
}));

appStore.subscribe((s, p) => {
  if (s.quota !== p.quota || s.maxChunk !== p.maxChunk) saveJSON(APP, { quota: s.quota, maxChunk: s.maxChunk });
});

export function setKey(key: string | null, remember: boolean): void {
  const k = key?.trim() || null;
  try {
    removeKey(KEY_STORAGE);
    globalThis.sessionStorage?.removeItem(KEY_STORAGE);
    if (k) (remember ? globalThis.localStorage : globalThis.sessionStorage)?.setItem(KEY_STORAGE, k);
  } catch {
    /* storage unavailable: the key lasts for this page only */
  }
  appStore.setState({ key: k, remember });
}

export function noteQuota(endpoint: 'matrix' | 'snap' | 'geocode', q: Quota | null): void {
  if (q) appStore.setState((s) => ({ quota: { ...s.quota, [endpoint]: q } }));
}

/** Remaining requests, if the last reading is still current (the quota is a rolling 24 hours). */
export function remaining(endpoint: 'matrix' | 'snap'): number | null {
  const q = appStore.getState().quota[endpoint];
  if (!q) return null;
  if (q.resetAt && Date.now() > q.resetAt) return null;
  if (!q.resetAt && Date.now() - q.seenAt > 24 * 3600_000) return null;
  return q.remaining;
}
