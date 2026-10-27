import { tripsPerWeek } from '../domain/frequency';
import { tripPlace, tripTravellers } from '../domain/formula';
import type { BBox, Id, LonLat, Scenario } from '../domain/types';
import { LEVEL, spacing, type Level, type MercBox } from './lattice';
import { fromMercator, groundScale, haversine, toMercator } from './mercator';

export interface Area {
  box: MercBox;
  centre: LonLat;
  level: Level;
  /** Places with trips that were left out of the area's extent (still counted in the totals). */
  far: Id[];
  /** The area holds more standard points than is sensible; suggest narrowing. */
  large: boolean;
  auto: boolean;
}

/** Places count towards the area's extent when visited at least this often (trips × travellers per week)… */
const CORE_MIN_WEIGHT = 0.25;
/** …and when within this distance of the weighted centre. */
const CORE_MAX_KM = 40;
const MIN_MARGIN_M = 3000;
const MARGIN_SHARE = 0.2;
const MIN_SIDE_M = 10000;
/** Raw standard points above which we suggest narrowing, and above which we fall back to the coarse level. */
const LARGE_POINTS = 9000;
const HUGE_POINTS = 16000;

function weightedMedian(values: number[], weights: number[]): number {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const i of order) {
    acc += weights[i];
    if (acc >= total / 2) return values[i];
  }
  return values[order[order.length - 1]];
}

/** Each placed place's weight: trips per week × travellers, over enabled trips. */
export function placeWeights(s: Scenario): Map<Id, { location: LonLat; weight: number }> {
  const places = new Map(s.places.map((p) => [p.id, p]));
  const out = new Map<Id, { location: LonLat; weight: number }>();
  for (const p of s.places) if (p.location) out.set(p.id, { location: p.location, weight: 0 });
  for (const t of s.trips) {
    const p = tripPlace(t, places);
    if (!p || !t.enabled) continue;
    out.get(p.id)!.weight += tripsPerWeek(t.frequency) * Math.max(1, tripTravellers(t, s).length);
  }
  return out;
}

function snapOut(box: MercBox): MercBox {
  const g = spacing(LEVEL.coarse);
  return [Math.floor(box[0] / g) * g, Math.floor(box[1] / g) * g, Math.ceil(box[2] / g) * g, Math.ceil(box[3] / g) * g];
}

function pointsAt(box: MercBox, level: Level): number {
  const s = spacing(level);
  return (Math.floor((box[2] - box[0]) / s) + 1) * (Math.floor((box[3] - box[1]) / s) + 1);
}

function finish(box: MercBox, centre: LonLat, far: Id[], auto: boolean): Area {
  const n = pointsAt(box, LEVEL.standard);
  return { box, centre, far, auto, level: n > HUGE_POINTS ? LEVEL.coarse : LEVEL.standard, large: n > LARGE_POINTS };
}

/** The search area chosen from the places: robust to a far-away, rarely visited destination. */
export function autoArea(s: Scenario): Area {
  const weighted = [...placeWeights(s).entries()];
  if (weighted.length === 0) return areaAround(s.region.centre);
  const anyWeight = weighted.some(([, v]) => v.weight > 0);
  const w = weighted.map(([, v]) => (anyWeight ? v.weight : 1));
  const merc = weighted.map(([, v]) => toMercator(v.location));
  const centreM: [number, number] = [weightedMedian(merc.map((m) => m[0]), w), weightedMedian(merc.map((m) => m[1]), w)];
  const centre = fromMercator(centreM);
  const near = (i: number) => haversine(weighted[i][1].location, centre) <= CORE_MAX_KM * 1000;
  let core = weighted.map((_, i) => i).filter((i) => near(i) && (!anyWeight || w[i] >= CORE_MIN_WEIGHT));
  if (core.length === 0) core = weighted.map((_, i) => i).filter(near);
  if (core.length === 0) core = [w.indexOf(Math.max(...w))];
  const coreSet = new Set(core);
  const far = weighted.filter(([, v], i) => !coreSet.has(i) && v.weight > 0).map(([id]) => id);

  let box: MercBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const i of core) {
    const [x, y] = merc[i];
    box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
  }
  const k = groundScale(centre[1]); // ground metres per Mercator metre
  const sideG = Math.max(box[2] - box[0], box[3] - box[1]) * k;
  const margin = Math.max(MIN_MARGIN_M, MARGIN_SHARE * sideG) / k;
  box = [box[0] - margin, box[1] - margin, box[2] + margin, box[3] + margin];
  const minSide = MIN_SIDE_M / k;
  for (const [a, b] of [[0, 2], [1, 3]] as const) {
    const grow = (minSide - (box[b] - box[a])) / 2;
    if (grow > 0) {
      box[a] -= grow;
      box[b] += grow;
    }
  }
  return finish(snapOut(box), centre, far, true);
}

export function areaAround(centre: LonLat, halfSideM = 8000): Area {
  const [x, y] = toMercator(centre);
  const h = halfSideM / groundScale(centre[1]);
  return finish(snapOut([x - h, y - h, x + h, y + h]), centre, [], true);
}

export function manualArea(bbox: BBox): Area {
  const [x0, y0] = toMercator([bbox[0], bbox[1]]);
  const [x1, y1] = toMercator([bbox[2], bbox[3]]);
  const box = snapOut([x0, y0, x1, y1]);
  return finish(box, fromMercator([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]), [], false);
}

export function areaFor(s: Scenario): Area {
  return s.settings.area.mode === 'manual' ? manualArea(s.settings.area.bbox) : autoArea(s);
}

export function areaBBox(a: Area): BBox {
  const [w, sth] = fromMercator([a.box[0], a.box[1]]);
  const [e, n] = fromMercator([a.box[2], a.box[3]]);
  return [w, sth, e, n];
}
