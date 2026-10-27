import type { LonLat } from '../../domain/types';
import { orsPost, type Quota } from './client';

interface MatrixLocation {
  location: LonLat;
  snapped_distance?: number;
}

interface MatrixResponse {
  durations?: (number | null)[][];
  distances?: (number | null)[][];
  sources?: (MatrixLocation | null)[];
  destinations?: (MatrixLocation | null)[];
}

export interface OneToMany {
  /** Minutes per point (NaN = no route). */
  minutes: Float32Array;
  /** Route length in km per point (NaN = no route). */
  km: Float32Array;
  /** How far each point was from the road it was routed from, in metres (NaN = not found). */
  snappedM: Float32Array;
  /** The place itself couldn't be placed on a road. */
  placeUnroutable: boolean;
  quota: Quota | null;
}

/**
 * Travel times between one place and many points. `to` = point → place (the leg there);
 * `from` = place → point (the leg back). Always lists sources and destinations: leaving them out makes the
 * server compute every pair and refuse with 6004.
 */
export async function oneToMany(profile: string, place: LonLat, points: LonLat[], dir: 'to' | 'from', key: string, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<OneToMany> {
  const n = points.length;
  const others = points.map((_, i) => i + 1);
  const body = {
    locations: [place, ...points],
    sources: dir === 'to' ? others : [0],
    destinations: dir === 'to' ? [0] : others,
    metrics: ['duration', 'distance'],
    units: 'km',
  };
  const { data, quota } = await orsPost<MatrixResponse>(`/v2/matrix/${profile}`, body, key, signal, fetchImpl);
  const minutes = new Float32Array(n).fill(Number.NaN);
  const km = new Float32Array(n).fill(Number.NaN);
  const snappedM = new Float32Array(n).fill(Number.NaN);
  const pick = (m: (number | null)[][] | undefined, i: number) => (dir === 'to' ? m?.[i]?.[0] : m?.[0]?.[i]);
  const pointLocs = dir === 'to' ? data.sources : data.destinations;
  const placeLoc = dir === 'to' ? data.destinations?.[0] : data.sources?.[0];
  for (let i = 0; i < n; i++) {
    const d = pick(data.durations, i);
    if (typeof d === 'number') minutes[i] = d / 60;
    const k = pick(data.distances, i);
    if (typeof k === 'number') km[i] = k;
    const loc = pointLocs?.[i];
    if (loc && typeof loc.snapped_distance === 'number') snappedM[i] = loc.snapped_distance;
    else if (loc) snappedM[i] = 0;
  }
  return { minutes, km, snappedM, placeUnroutable: placeLoc === null, quota };
}

/** Full matrix between a few points (shortlist ↔ places). Minutes [from][to]. */
export async function smallMatrix(profile: string, sources: LonLat[], destinations: LonLat[], key: string, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<{ minutes: number[][]; quota: Quota | null }> {
  const locations = [...sources, ...destinations];
  const body = { locations, sources: sources.map((_, i) => i), destinations: destinations.map((_, i) => sources.length + i), metrics: ['duration'] };
  const { data, quota } = await orsPost<MatrixResponse>(`/v2/matrix/${profile}`, body, key, signal, fetchImpl);
  return { minutes: (data.durations ?? []).map((row) => row.map((v) => (typeof v === 'number' ? v / 60 : Number.NaN))), quota };
}
