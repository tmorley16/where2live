import type { LonLat } from '../../domain/types';
import { orsPost, type Quota } from './client';

interface SnapResponse {
  locations?: ({ location: LonLat; snapped_distance?: number; name?: string } | null)[];
}

/** For each point: metres to the nearest road for the profile, or NaN when none is within `radius`. */
export async function snapDistances(profile: string, points: LonLat[], radius: number, key: string, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<{ metres: Float32Array; quota: Quota | null }> {
  const { data, quota } = await orsPost<SnapResponse>(`/v2/snap/${profile}`, { locations: points, radius }, key, signal, fetchImpl);
  const metres = new Float32Array(points.length).fill(Number.NaN);
  (data.locations ?? []).forEach((l, i) => {
    if (l && i < metres.length) metres[i] = typeof l.snapped_distance === 'number' ? l.snapped_distance : 0;
  });
  return { metres, quota };
}
