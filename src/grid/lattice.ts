import type { LonLat } from '../domain/types';
import { fromMercator, toMercator } from './mercator';

/**
 * Candidate homes sit on a global Web Mercator lattice: point (i, j) at level k is at Mercator (i·2^k, j·2^k) m.
 * Levels nest (every coarse point is also a finer point), and every point has one canonical integer id at the
 * finest level, independent of the search area, so cached travel times are reused when the area moves or grows.
 */
export type Level = 8 | 9 | 10;
export const LEVEL = { fine: 8, standard: 9, coarse: 10 } as const satisfies Record<string, Level>;

export function spacing(level: Level): number {
  return 2 ** level;
}

const OFFSET = 2 ** 17;
const SPAN = 2 ** 18;

/** Id of the finest-level point (i8, j8). Fits easily in a double (< 2^36). */
export function pointId(i8: number, j8: number): number {
  return (i8 + OFFSET) * SPAN + (j8 + OFFSET);
}

export function decodeId(id: number): [number, number] {
  const a = Math.floor(id / SPAN);
  return [a - OFFSET, id - a * SPAN - OFFSET];
}

export function idAt(level: Level, i: number, j: number): number {
  const f = 2 ** (level - LEVEL.fine);
  return pointId(i * f, j * f);
}

export function idToMercator(id: number): [number, number] {
  const [i8, j8] = decodeId(id);
  return [i8 * spacing(LEVEL.fine), j8 * spacing(LEVEL.fine)];
}

export function idToLonLat(id: number): LonLat {
  return fromMercator(idToMercator(id));
}

/** Is the point on (a member of) the given level? */
export function onLevel(id: number, level: Level): boolean {
  const f = 2 ** (level - LEVEL.fine);
  const [i8, j8] = decodeId(id);
  return ((i8 % f) + f) % f === 0 && ((j8 % f) + f) % f === 0;
}

/** Mercator bounds [minX, minY, maxX, maxY]. */
export type MercBox = [number, number, number, number];

/**
 * A rectangular block of lattice points at one level. Element (c, r), stored at r·nx + c, is lattice point
 * (i0 + c, jTop − r): rows run north to south, as in an image.
 */
export interface GridWindow {
  level: Level;
  s: number;
  i0: number;
  jTop: number;
  nx: number;
  ny: number;
}

export function windowFor(box: MercBox, level: Level): GridWindow {
  const s = spacing(level);
  const i0 = Math.ceil(box[0] / s);
  const i1 = Math.floor(box[2] / s);
  const jBottom = Math.ceil(box[1] / s);
  const jTop = Math.floor(box[3] / s);
  return { level, s, i0, jTop, nx: Math.max(0, i1 - i0 + 1), ny: Math.max(0, jTop - jBottom + 1) };
}

export function windowKey(w: GridWindow): string {
  return `${w.level}:${w.i0}:${w.jTop}:${w.nx}x${w.ny}`;
}

export function windowIds(w: GridWindow): Float64Array {
  const ids = new Float64Array(w.nx * w.ny);
  for (let r = 0; r < w.ny; r++) for (let c = 0; c < w.nx; c++) ids[r * w.nx + c] = idAt(w.level, w.i0 + c, w.jTop - r);
  return ids;
}

export function elementMercator(w: GridWindow, c: number, r: number): [number, number] {
  return [(w.i0 + c) * w.s, (w.jTop - r) * w.s];
}

/** Fractional element coordinates (c, r) of a Mercator point. */
export function mercatorToElement(w: GridWindow, [x, y]: [number, number]): [number, number] {
  return [x / w.s - w.i0, w.jTop - y / w.s];
}

export function lonLatToElement(w: GridWindow, p: LonLat): [number, number] {
  return mercatorToElement(w, toMercator(p));
}

/** The window's footprint: half a spacing beyond its outer points. */
export function windowBox(w: GridWindow): MercBox {
  const h = w.s / 2;
  return [w.i0 * w.s - h, (w.jTop - w.ny + 1) * w.s - h, (w.i0 + w.nx - 1) * w.s + h, w.jTop * w.s + h];
}

/** Corners (top-left, top-right, bottom-right, bottom-left) as lon/lat, for a MapLibre image source. */
export function windowCorners(w: GridWindow): [LonLat, LonLat, LonLat, LonLat] {
  const [x0, y0, x1, y1] = windowBox(w);
  return [fromMercator([x0, y1]), fromMercator([x1, y1]), fromMercator([x1, y0]), fromMercator([x0, y0])];
}
