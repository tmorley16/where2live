import { decodeId } from './lattice';

/** Morton (Z-order) key of a point id, so chunks of consecutive points cover compact areas. */
export function mortonKey(id: number): number {
  const [i8, j8] = decodeId(id);
  const x = i8 + 2 ** 17;
  const y = j8 + 2 ** 17;
  let key = 0;
  for (let b = 0; b < 18; b++) key += ((x >> b) & 1) * 2 ** (2 * b) + ((y >> b) & 1) * 2 ** (2 * b + 1);
  return key;
}

export function zOrder(ids: ArrayLike<number>): number[] {
  return Array.from(ids)
    .map((id) => [mortonKey(id), id] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, id]) => id);
}
