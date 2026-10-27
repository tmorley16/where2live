import type { LonLat } from '../domain/types';

/** Web Mercator (EPSG:3857), the map's own projection. */
export const EARTH_RADIUS = 6378137;
const D2R = Math.PI / 180;

export function toMercator([lon, lat]: LonLat): [number, number] {
  return [EARTH_RADIUS * lon * D2R, EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2))];
}

export function fromMercator([x, y]: [number, number]): LonLat {
  return [x / EARTH_RADIUS / D2R, (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) / D2R];
}

/** Ground metres per Mercator metre at a latitude. */
export function groundScale(lat: number): number {
  return Math.cos(lat * D2R);
}

/** Great-circle distance in metres. */
export function haversine([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number {
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}
