# Where2Live

Helps people decide where to live by mapping the total weekly travel time from every possible home to the places they go regularly (work, church, gym, shops, friends). Built first for the user and their partner choosing a rental after they marry. Plan: `C:\Users\tomm_xacom\.claude\plans\starting-completely-from-scratch-magical-wall.md` (milestones M1–M8).

## Non-negotiables

- **Australian English** in all site copy (colour, centre, organise, minimise, kilometres).
- **"Try, see and test"**: where a design choice is cheap, build it as a switchable setting to compare. Keep visuals simple and clean: no added glows, outlines/casings, drop shadows or dark techy themes. Check screenshots before showing visual changes.
- **Personal-first, no backend**: each user pastes their own free openrouteservice key (account.heigit.org). The key is stored only in the browser, sent only to `api.heigit.org`, never exported, never committed. Scripts read it from git-ignored `.env.local` as `ORS_KEY` (never `VITE_`-prefixed).
- **Use `https://api.heigit.org/openrouteservice`**; the old `api.openrouteservice.org` host shuts down in November 2026.
- **Privacy**: scenarios hold home and friends' addresses; they stay in the browser. No analytics. Nothing personal in the repo; the demo is fictional.
- **Storage keys start with `w2l`** (localStorage keys, IndexedDB name): on GitHub Pages the origin is shared with jesus-tracker.
- **Commit or push only when the user asks.** They try work on the live GitHub Pages site (M8), not on local servers or preview Artifacts.
- **Test in proportion**: small change → `npm run check`, `npm test` (Vitest, fast) and the one relevant e2e spec; the full Playwright suite only for broad changes.

## Architecture

- Static SPA: Vite 8 + React 19 + TypeScript 6.0.3 (pinned; matches jesus-tracker). Exact-pinned dependencies. A Content-Security-Policy meta is added to builds only (`vite.config.ts`): connect-src is api.heigit.org, photon.komoot.io, tiles.openfreemap.org (+ data:). Add a host there if a new service is used.
- Slow part vs fast part: travel-time *fields* (minutes between one place and every lattice point, per mode and direction; spec key `mode|dir|lon5,lat5`) are fetched once and cached; the weekly total is a linear form over fields (`src/domain/formula.ts`, weights recomputed on every edit) evaluated over the window, contoured and drawn, about 2 ms per update.
- Formula: T(h) = Σ trips a·w·[o·μ_out·D_to(h) + b·μ_back·D_from(h) + (o+b)·e]; a = travellers (or 1 for shared trips under household counting), w = trips/week, μ = time-band multiplier (car only), e = overhead per leg. Views: balanced (default, user's request 28 Oct 2026: total + ½·Σ(max − each person), i.e. total + half the gap for two; `BALANCE` in `src/compute/surface.ts`), total (kind `combined`), fairest (max over people), one person. Test vector in `tests/unit/formula.test.ts` (608.83 min per person).
- Lattice (`src/grid/lattice.ts`): global Web Mercator points at 1,024 / 512 / 256 m (levels 10/9/8, ≈850/425/212 m in Sydney), nested, canonical integer ids. Area (`src/grid/area.ts`): weighted-median centre, core places (≥0.25 trips/wk, ≤40 km) set the box; far places counted but outside; snapped to the coarse lattice.
- Engine (`src/compute/engine.ts`): one instance; recomputes on the next frame after any scenario change; freezes band edges and the area while a slider is dragged (`uiStore.dragging`), so drags never fetch. Masks: basemap water (and national parks for estimates) rasterised from OpenFreeMap tiles (`src/map/mask.ts`), plus the provider's road check. `setMask` ignores no-op changes (a no-op used to loop engine → redraw → idle → engine).
- Providers (`src/routing/`): `EstimateProvider` (straight line × detour ÷ speed) and `OrsProvider`: road check (snap, driving-car, 300 m) → coarse matrix pass → standard pass; 1×N one-to-many, ≤3,400 points per request (learned down on 6004); all-null responses (ORS bug #1785) → probe the place, then split into quarters to find the island point; cache in IndexedDB (`w2l-fields`, `w2l-snaps`, 60 days), keyed by coordinates. Scheduler (`src/jobs/scheduler.ts`): sliding 38/min (matrix), 90/min (snap), 3 in flight, back-off, pauses on 429/403-quota, stops on bad key, asks before batches > 30 requests. `src/routing/wire.ts` swaps providers when the key changes; `exact.ts` gives exact times for shortlisted homes (2 requests per profile per batch, `w2l-pairs`).
- Map: raw MapLibre 6 (no react-map-gl), lazy-loaded, worker via `?worker&url` + `setWorkerUrl` (as in jesus-tracker). Basemap OpenFreeMap positron (`src/map/style.ts`); bands go beneath its `water` layer with `fill-layer-opacity` (nested d3 contours on −T); Cells/Smooth draw a canvas image source. `?style=blank` gives a no-network style for tests. `?debug` exposes `window.__w2l` (map, engine, stores).
- UI (`src/ui/`): Panel (summary, spot card, people, tabs: Places & trips · Shortlist · Settings), KeyDialog, RoutingStatus (notice, confirm card, map chip). Search (`src/routing/geocode.ts`): ORS Pelias autocomplete with a key (clean street addresses), Photon without one (or if Pelias fails); spot names via Photon reverse.
- Place cards are compact (user's request, 27 Oct 2026): a header (category dot over an invisible select, name, "Any branch" toggle, ×), one address line, and per trip two lines: who · mode select · time band · on/off, then slider · number · unit · ⋯. Together, per-leg bands, legs, extra minutes, traffic override and "Add another trip here" live behind ⋯.
- "Any branch" places (`Place.anyOf`, the user's request: any Woolworths/Coles/Aldi, any Revo Fitness): a field's `targets` is every branch and its value the minimum over them; both legs use the `to` field. Each home is routed only to its candidate branches (`src/grid/nearest.ts`: 4 nearest by straight line + any within 1.5× + 1 km, max 8). ORS keeps one sparse field per branch (same key as a place there) filled by many-to-many requests (homes × branches ≤ 3,400, Z-order tiles), so removing a branch costs nothing and adding one only a few requests. Branches come from Photon (`src/routing/chains.ts`; ≤50 results per box, so full boxes split into quarters twice, two requests at a time with one retry; whole-word name match; supermarket presets need shop=supermarket; same chain within 150 m merged) or are added by hand (Revo Fitness isn't in OpenStreetMap in Sydney). `src/routing/branches.ts` searches again when the area outgrows `anyOf.searched`. Overpass was down (502) when tried, so it isn't used. Branch dots are a circle layer; such places have no pin and don't stretch the area.
- Which kinds branch (`BRANCHING` in `src/domain/modes.ts`, user's request 28 Oct 2026): supermarkets and "Chain or service" are always any-branch (no toggle; a new supermarket has Woolworths, Coles and Aldi ticked and `src/routing/branches.ts` searches them automatically; old saved supermarkets migrate in `validate.ts`); gym and other have the toggle; work, study, church, friends, family never branch. Chain search: three requests at a time across all chains, Pelias fallback (with a key) when Photon is down. Focus (`settings.branchRouting`, default 'focus'): any-branch fields get road times only where the current total is in the better 40% of the map (`Stats.p40`, passed to `need()`); elsewhere the estimate stands and isn't counted as still loading.
- The page itself never scrolls (`html, body { overflow: hidden }`, `.panel { position: relative }`): absolutely positioned screen-reader text once stretched the page to the panel's full height (a grey area below the app).

## ORS facts from the live spike (27 Oct 2026, engine 9.10.0)

- Matrix 1×3,400 works for driving-car, foot-walking and cycling-regular (no 25-route cap); 3,501 → HTTP 400 `{error:{code:6004}}`. ~2.3–3.6 s per 3,400-point request.
- Quotas from headers: matrix 500/day, snap 2,000/day, Pelias 3,000/day; `x-ratelimit-reset` is epoch seconds (the very first response of a window reports "now", later ones start + 24 h).
- Harbour points snap to a shore road (~45 m) and get plausible times: the basemap water mask is what removes them. Scotland Island snapped 592 m to the mainland (caught by the >300 m snapped_distance check); bug #1785 didn't show.
- to vs from differs by about ±1–2 min (median −0.3), so "same time both ways" is a fair saving when quota is tight.
- Pelias on `api.heigit.org/pelias/v1` accepts the key in the Authorization header (or `api_key`). Fixtures in `tests/fixtures/ors/` are recorded from this run (`npm run spike -- --record`).

## Hosting

- Public repo `tmorley16/where2live`; every push to `main` runs unit tests, builds with `BASE_PATH=/where2live/` and deploys to https://tmorley16.github.io/where2live/ (`.github/workflows/deploy.yml`). Push only when the user asks.

## Commands

- `npm run dev` (port 5173, fixed) · `npm run build` (type check + build) · `npm run preview` (port 4173) · `npm run check`
- `npm test` — Vitest unit tests (`tests/unit`)
- `npm run e2e` — Playwright on the installed Edge with SwiftShader, desktop + Pixel 7 (`tests/e2e`); needs `npm run build` first
- `npm run spike` — ORS API spike (needs `ORS_KEY` in `.env.local`; `-- --record` saves fixtures)
- `node scripts/shot.mjs [--demo] [--phone] [--blank] [--click="A|B"] [--mapclick=x,y] [--hover=x,y] [--out=…]` — screenshot the preview build (for my own visual checks); `node scripts/perf.mjs` — recompute timing

## Windows notes

- Shell is PowerShell 5.1; use `npm.cmd`/`npx.cmd` in PowerShell scripts. Line endings are LF (`.gitattributes`).
- Git commits as `tmorley16` with GitHub's noreply address (repo-local config).
