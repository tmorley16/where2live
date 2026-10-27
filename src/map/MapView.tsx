import { useEffect, useRef, useState } from 'react';
import { AttributionControl, Map as MlMap, NavigationControl, ScaleControl, setWorkerUrl, type LngLatBoundsLike, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { engine, resultStore } from '../compute/engine';
import { fmtDuration, fmtHM } from '../compute/format';
import { homeResult, letter } from '../compute/homes';
import { sampleAt } from '../compute/sample';
import { exactStore } from '../routing/exact';
import { exact } from '../routing/wire';
import { defaultSettings } from '../domain/presets';
import type { LonLat } from '../domain/types';
import { areaBBox, type Area } from '../grid/area';
import { appStore } from '../state/appStore';
import { edit, getScenario, scenarioStore } from '../state/scenarioStore';
import { uiStore } from '../state/uiStore';
import { SurfaceLayers } from './layers';
import { basemapMask, windowInView } from './mask';
import { BestMarker, CandidateMarkers, PlaceMarkers, ProbeMarker } from './markers';
import { MapOverlay } from './MapOverlay';
import { styleFor } from './style';

setWorkerUrl(new URL(workerUrl, import.meta.url).href);

function fitArea(map: MlMap, area: Area, animate: boolean) {
  const [w, s, e, n] = areaBBox(area);
  map.fitBounds([w, s, e, n] as LngLatBoundsLike, { padding: { top: 56, bottom: 36, left: 36, right: 36 }, duration: animate ? 600 : 0 });
}

export default function MapView() {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let map: MlMap;
    try {
      map = new MlMap({
        container: box.current!,
        style: styleFor(location.search),
        center: getScenario()?.region.centre ?? [151.15, -33.84],
        zoom: 10,
        attributionControl: false,
      });
    } catch {
      // MapLibre 6 needs WebGL2 and throws without it.
      setError('This browser can’t draw the map (it needs WebGL2). Try an up-to-date Chrome, Edge, Firefox or Safari.');
      return;
    }
    map.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: 'Road times <a href="https://openrouteservice.org" target="_blank" rel="noreferrer">openrouteservice</a> by HeiGIT · Search <a href="https://photon.komoot.io" target="_blank" rel="noreferrer">Photon</a>',
      }),
      'bottom-right',
    );
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right');
    const debug = new URLSearchParams(location.search).has('debug');
    if (debug) (window as unknown as { __w2l: object }).__w2l = { map, engine, resultStore, scenarioStore, uiStore, appStore };

    const cleanups: (() => void)[] = [];
    map.on('load', () => {
      const layers = new SurfaceLayers(map);
      const places = new PlaceMarkers(map, (id, location) =>
        edit((d) => {
          const p = d.places.find((x) => x.id === id);
          if (p) {
            p.location = location;
            delete p.address;
          }
        }),
      );
      const best = new BestMarker(map);
      let fitted = false;

      const draw = () => {
        const { frame, area } = resultStore.getState();
        const s = getScenario();
        layers.render(frame, s?.settings.display ?? defaultSettings().display);
        layers.showArea(frame ? area : null); // no outline until there's something to show in it
        best.show(frame?.best ?? null, frame?.stats.min ?? Number.NaN);
        places.sync(s?.places ?? [], new Set(area?.far ?? []));
        if (!fitted && area) {
          fitArea(map, area, false);
          fitted = true;
        }
      };
      cleanups.push(resultStore.subscribe(draw));
      cleanups.push(scenarioStore.subscribe((st) => places.sync(st.scenario?.places ?? [], new Set(resultStore.getState().area?.far ?? []))));
      cleanups.push(
        uiStore.subscribe((st, prev) => {
          // Wait a moment so the engine has worked out the new area first (it runs on the next frame).
          if (st.fitRequest !== prev.fitRequest)
            setTimeout(() => {
              const area = resultStore.getState().area;
              if (area) fitArea(map, area, true);
            }, 60);
          map.getCanvas().style.cursor = st.picking ? 'crosshair' : '';
        }),
      );
      draw();

      // Water (and, for estimates, national parks) from the basemap: no homes there.
      const updateMask = () => {
        const cw = engine.currentWindow;
        const frame = resultStore.getState().frame;
        if (!cw || !frame || !map.getSource('openmaptiles')) return; // no basemap water to read (e.g. the test style)
        const parks = frame.estimate;
        if (engine.hasMask('water', cw.key) && (parks ? engine.hasMask('parks', cw.key) : true)) return;
        if (!windowInView(map, cw.window)) return;
        const water = basemapMask(map, cw.window, false);
        if (water) engine.setMask('water', cw.key, water);
        engine.setMask('parks', cw.key, parks ? basemapMask(map, cw.window, true) : null);
      };
      map.on('idle', updateMask);
      const noteView = () => {
        const b = map.getBounds();
        uiStore.setState({ viewBBox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] });
      };
      map.on('moveend', noteView);
      noteView();

      // Hover readout, at most once per frame.
      let move: MapMouseEvent | null = null;
      let queued = false;
      map.on('mousemove', (e) => {
        move = e;
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          const ev = move;
          const frame = resultStore.getState().frame;
          if (!ev || !frame) return uiStore.setState({ hover: null });
          const p: LonLat = [ev.lngLat.lng, ev.lngLat.lat];
          const smp = sampleAt(frame.values, frame.window, p);
          uiStore.setState({ hover: smp ? { lonlat: p, x: ev.point.x, y: ev.point.y, value: smp.value, lo: smp.lo, hi: smp.hi, breakdown: engine.breakdownAt(p) } : null });
        });
      });
      map.getCanvas().addEventListener('mouseleave', () => {
        move = null;
        uiStore.setState({ hover: null });
      });

      // The clicked spot, and the shortlist's pins.
      const probe = new ProbeMarker(map, (at) => uiStore.setState({ probe: at }));
      const candidates = new CandidateMarkers(map);
      const syncCandidates = () => {
        const s = getScenario();
        if (!s) return candidates.sync([]);
        const at = uiStore.getState().probe;
        candidates.sync(
          s.candidates
            .map((c, i) => ({ c, i }))
            // While the clicked-spot pin is on a shortlisted home, it stands in for that home's pin.
            .filter(({ c }) => !at || Math.abs(c.location[0] - at[0]) > 1e-5 || Math.abs(c.location[1] - at[1]) > 1e-5)
            .map(({ c, i }) => {
            const res = homeResult(s, c.location, exact, engine, true);
            const l = letter(i);
            return {
              id: c.id,
              letter: l,
              location: c.location,
              current: c.kind === 'current-home',
              text: res ? `${l} · ${fmtHM(res.value)}` : l,
              title: `${c.label}${res ? `: about ${fmtDuration(res.value)} a week${res.exact ? '' : ' (approximate)'}` : ''}`,
            };
          }),
        );
      };
      cleanups.push(resultStore.subscribe(syncCandidates));
      cleanups.push(exactStore.subscribe(syncCandidates));
      cleanups.push(
        uiStore.subscribe((st, prev) => {
          if (st.probe !== prev.probe) {
            probe.show(st.probe);
            syncCandidates();
          }
          if (st.flyTo && st.flyTo !== prev.flyTo) map.flyTo({ center: st.flyTo.at, zoom: Math.max(map.getZoom(), 13), duration: 700 });
        }),
      );
      syncCandidates();
      probe.show(uiStore.getState().probe);
      cleanups.push(() => {
        probe.remove();
        candidates.remove();
      });

      // Picking a place's location by clicking the map; otherwise a click shows that spot trip by trip.
      map.on('click', (e) => {
        if ((e.originalEvent.target as HTMLElement | null)?.closest?.('.maplibregl-marker')) return; // a click on a pin
        const picking = uiStore.getState().picking;
        if (!picking) {
          if (resultStore.getState().frame) uiStore.setState({ probe: [Math.round(e.lngLat.lng * 1e5) / 1e5, Math.round(e.lngLat.lat * 1e5) / 1e5] });
          return;
        }
        const location: LonLat = [Math.round(e.lngLat.lng * 1e5) / 1e5, Math.round(e.lngLat.lat * 1e5) / 1e5];
        edit((d) => {
          const p = d.places.find((x) => x.id === picking);
          if (p) {
            p.location = location;
            delete p.address;
          }
        });
        uiStore.setState({ picking: null });
      });

      cleanups.push(() => {
        places.remove();
        best.remove();
      });
    });
    return () => {
      cleanups.forEach((f) => f());
      map.remove();
    };
  }, []);

  if (error) return <div className="map-note">{error}</div>;
  return (
    <>
      <div ref={box} className="map" />
      <MapOverlay />
    </>
  );
}
