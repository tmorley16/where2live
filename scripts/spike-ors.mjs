// ORS API spike (M4): checks the behaviour the app relies on, using about 20 requests of your free quota.
// Needs ORS_KEY in .env.local. Run: npm run spike   (add --record to save fixtures to tests/fixtures/ors/)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\s*[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const KEY = env.ORS_KEY;
if (!KEY) {
  console.error('Add your key to .env.local as ORS_KEY=… (from https://account.heigit.org).');
  process.exit(1);
}
const BASE = 'https://api.heigit.org/openrouteservice';
const RECORD = process.argv.includes('--record');
const fixtures = new URL('../tests/fixtures/ors/', import.meta.url);
if (RECORD) mkdirSync(fixtures, { recursive: true });
const save = (name, data) => RECORD && writeFileSync(new URL(name, fixtures), JSON.stringify(data, null, 1));

const rate = (h) => ({ remaining: h.get('x-ratelimit-remaining'), reset: h.get('x-ratelimit-reset'), limit: h.get('x-ratelimit-limit') });
async function post(path, body) {
  const t = performance.now();
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { Authorization: KEY, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  const ms = Math.round(performance.now() - t);
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, ms, json, rate: rate(res.headers) };
}

// Web Mercator lattice at 512 m around a centre (same as the app's standard level).
const R = 6378137;
const toM = ([lon, lat]) => [(R * lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
const fromM = ([x, y]) => [((x / R) * 180) / Math.PI, ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI];
function lattice(centre, n, s = 512) {
  const [cx, cy] = toM(centre);
  const side = Math.ceil(Math.sqrt(n));
  const pts = [];
  for (let i = 0; i < side && pts.length < n; i++) for (let j = 0; j < side && pts.length < n; j++) pts.push(fromM([Math.round(cx / s + i - side / 2) * s, Math.round(cy / s + j - side / 2) * s]));
  return pts.map(([lon, lat]) => [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]);
}

const WYNYARD = [151.2057, -33.8657];
const RYDE = [151.1057, -33.8153];
const PARRA = [151.0034, -33.8151];
const out = {};
const log = (k, v) => {
  out[k] = v;
  console.log(`\n## ${k}\n${JSON.stringify(v, null, 1)}`);
};
const nulls = (rows) => rows.flat().filter((v) => v === null).length;

// 1. Snap one point, and the rate-limit headers.
{
  const r = await post('/v2/snap/driving-car', { locations: [WYNYARD], radius: 300 });
  log('1 snap one point', { status: r.status, ms: r.ms, rate: r.rate, body: r.json });
  save('snap-one.json', r.json);
}

// 2–3. One-to-many, both directions, driving-car, 3,400 lattice points around Ryde.
const pts = lattice([151.12, -33.83], 3400);
for (const [dir, sources, destinations] of [
  ['from place (1×3400)', [0], pts.map((_, i) => i + 1)],
  ['to place (3400×1)', pts.map((_, i) => i + 1), [0]],
]) {
  const r = await post('/v2/matrix/driving-car', { locations: [WYNYARD, ...pts], sources, destinations, metrics: ['duration', 'distance'] });
  const d = r.json?.durations;
  const snapped = (dir.startsWith('from') ? r.json?.destinations : r.json?.sources) ?? [];
  const sd = snapped.filter(Boolean).map((x) => x.snapped_distance).sort((a, b) => a - b);
  log(`2 matrix driving-car ${dir}`, {
    status: r.status,
    ms: r.ms,
    rate: r.rate,
    error: r.json?.error,
    rows: d?.length,
    cols: d?.[0]?.length,
    nullDurations: d ? nulls(d) : null,
    nullPoints: snapped.filter((x) => x === null).length,
    snappedMetres: sd.length ? { p50: sd[Math.floor(sd.length / 2)], p90: sd[Math.floor(sd.length * 0.9)], max: sd.at(-1), over300: sd.filter((x) => x > 300).length } : null,
    metadata: r.json?.metadata?.engine,
  });
  out[`durations ${dir}`] = d;
}
{
  const a = out['durations from place (1×3400)']?.[0];
  const b = out['durations to place (3400×1)']?.map((row) => row[0]);
  if (a && b) {
    const diffs = a.map((v, i) => (v !== null && b[i] !== null ? (b[i] - v) / 60 : null)).filter((x) => x !== null).sort((x, y) => x - y);
    log('3 asymmetry to−from (min)', { p10: diffs[Math.floor(diffs.length * 0.1)], p50: diffs[Math.floor(diffs.length / 2)], p90: diffs[Math.floor(diffs.length * 0.9)] });
  }
}

// 4. Walking and cycling at 1×3,400 (risk: a 25-route cap for profiles without contraction hierarchies).
for (const profile of ['foot-walking', 'cycling-regular']) {
  const r = await post(`/v2/matrix/${profile}`, { locations: [RYDE, ...pts], sources: [0], destinations: pts.map((_, i) => i + 1), metrics: ['duration'] });
  log(`4 matrix ${profile} 1×3400`, { status: r.status, ms: r.ms, error: r.json?.error, cols: r.json?.durations?.[0]?.length, nullDurations: r.json?.durations ? nulls(r.json.durations) : null });
}

// 5. Over the limit: 3,501 routes.
{
  const many = lattice([151.12, -33.83], 3501);
  const r = await post('/v2/matrix/driving-car', { locations: [WYNYARD, ...many], sources: [0], destinations: many.map((_, i) => i + 1) });
  log('5 matrix 1×3501 (expect 6004)', { status: r.status, ms: r.ms, body: r.json?.error ?? r.json });
  save('error-6004.json', r.json);
}

// 6. Harbour, ocean and island points, in one small matrix.
{
  const odd = [
    [151.245, -33.852], // Sydney Harbour
    [151.4, -33.85], // ocean
    [151.2903, -33.6417], // Scotland Island (no road bridge)
    [151.1, -33.8], // land, for comparison
  ];
  const r = await post('/v2/matrix/driving-car', { locations: [WYNYARD, ...odd], sources: [0], destinations: [1, 2, 3, 4], metrics: ['duration'] });
  log('6 matrix with harbour/ocean/island/land', { status: r.status, body: r.json?.error ?? { durations: r.json?.durations, destinations: r.json?.destinations } });
  save('matrix-odd.json', r.json);
}

// 7. Snap 2,500 lattice points at 300 m.
{
  const r = await post('/v2/snap/driving-car', { locations: pts.slice(0, 2500), radius: 300 });
  const locs = r.json?.locations ?? [];
  log('7 snap 2500 @300 m', { status: r.status, ms: r.ms, rate: r.rate, error: r.json?.error, returned: locs.length, nulls: locs.filter((x) => x === null).length });
}

// A small matrix to keep as a fixture.
{
  const small = lattice([151.12, -33.83], 6);
  const r = await post('/v2/matrix/driving-car', { locations: [WYNYARD, ...small], sources: small.map((_, i) => i + 1), destinations: [0], metrics: ['duration', 'distance'] });
  save('matrix-to-6.json', { request: { locations: [WYNYARD, ...small] }, response: r.json });
}

// 8. Pelias autocomplete on the new host: header auth, then api_key.
const addresses = ['1 Macquarie Street, Sydney', '100 George Street, Parramatta', '48 Pirrama Road, Pyrmont', '436 Victoria Avenue, Chatswood', '1 Devlin Street, Ryde'];
for (const auth of ['header', 'param']) {
  const url = new URL('https://api.heigit.org/pelias/v1/autocomplete');
  url.searchParams.set('text', addresses[0]);
  url.searchParams.set('boundary.country', 'AU');
  url.searchParams.set('focus.point.lat', '-33.85');
  url.searchParams.set('focus.point.lon', '151.15');
  if (auth === 'param') url.searchParams.set('api_key', KEY);
  const res = await fetch(url, { headers: auth === 'header' ? { Authorization: KEY } : {} });
  let j = null;
  try {
    j = await res.json();
  } catch {}
  log(`8 pelias autocomplete (${auth})`, { status: res.status, rate: rate(res.headers), first: j?.features?.[0]?.properties?.label, error: j?.error ?? j?.geocoding?.errors });
}

// 9. Pelias vs Photon on five addresses.
for (const a of addresses) {
  const p = new URL('https://api.heigit.org/pelias/v1/search');
  p.searchParams.set('text', a);
  p.searchParams.set('boundary.country', 'AU');
  p.searchParams.set('size', '1');
  const pj = await (await fetch(p, { headers: { Authorization: KEY } })).json().catch(() => null);
  const ph = await (await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(a)}&limit=1&countrycode=AU`)).json().catch(() => null);
  log(`9 geocode “${a}”`, {
    pelias: pj?.features?.[0] && { label: pj.features[0].properties.label, layer: pj.features[0].properties.layer, at: pj.features[0].geometry.coordinates },
    photon: ph?.features?.[0] && { name: ph.features[0].properties.name, street: [ph.features[0].properties.housenumber, ph.features[0].properties.street].filter(Boolean).join(' '), type: ph.features[0].properties.type, at: ph.features[0].geometry.coordinates },
  });
}

writeFileSync(new URL('../test-results/spike-ors.json', import.meta.url), JSON.stringify(out, (k, v) => (k.startsWith('durations ') ? undefined : v), 1));
console.log('\nSaved the summary to test-results/spike-ors.json');
