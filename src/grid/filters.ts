/**
 * Clean-ups for routed fields (not needed for estimates, which are smooth).
 * `mask[k] = 1` marks points where no one can live (water, no road); those are never filled.
 */

const NEIGHBOURS: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

function neighbourValues(values: Float32Array, nx: number, ny: number, c: number, r: number, out: number[]): number[] {
  out.length = 0;
  for (const [dc, dr] of NEIGHBOURS) {
    const cc = c + dc;
    const rr = r + dr;
    if (cc < 0 || rr < 0 || cc >= nx || rr >= ny) continue;
    const v = values[rr * nx + cc];
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A point the router couldn't resolve, surrounded by points it could: take the neighbours' median. */
export function fillIsolatedGaps(values: Float32Array, nx: number, ny: number, mask?: Uint8Array): number {
  const fills: [number, number][] = [];
  const buf: number[] = [];
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      const k = r * nx + c;
      if (!Number.isNaN(values[k]) || mask?.[k]) continue;
      const nb = neighbourValues(values, nx, ny, c, r, buf);
      if (nb.length >= 6) fills.push([k, median(nb)]);
    }
  }
  for (const [k, v] of fills) values[k] = v;
  return fills.length;
}

/**
 * A point snapped onto the wrong side of a motorway (a one-way carriageway) can come out minutes slower or faster
 * than everything around it. Replace a point beyond all 8 neighbours by more than max(5 min, 20%) with their median.
 * A real edge (a river, the harbour) is never beyond *all* its neighbours, so it's left alone.
 */
export function despike(values: Float32Array, nx: number, ny: number, minDelta = 5, share = 0.2): number[] {
  const fixes: [number, number][] = [];
  const buf: number[] = [];
  for (let r = 1; r < ny - 1; r++) {
    for (let c = 1; c < nx - 1; c++) {
      const k = r * nx + c;
      const v = values[k];
      if (!Number.isFinite(v)) continue;
      const nb = neighbourValues(values, nx, ny, c, r, buf);
      if (nb.length < 8) continue;
      const lo = Math.min(...nb);
      const hi = Math.max(...nb);
      if (v > hi + Math.max(minDelta, share * hi) || v < lo - Math.max(minDelta, share * lo)) fixes.push([k, median(nb)]);
    }
  }
  for (const [k, m] of fixes) values[k] = m;
  return fixes.map(([k]) => k);
}
