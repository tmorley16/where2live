import { Marker, type Map as MlMap } from 'maplibre-gl';
import { fmtDuration } from '../compute/format';
import { CATEGORIES } from '../domain/modes';
import type { Id, LonLat, Place } from '../domain/types';

function el(className: string, html = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  d.innerHTML = html;
  return d;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** The places you go: a small dark dot with the category's glyph and the name beside it. */
export class PlaceMarkers {
  private markers = new Map<Id, { marker: Marker; key: string }>();
  private declutterQueued = false;
  constructor(
    private map: MlMap,
    private onMove: (id: Id, location: LonLat) => void,
  ) {
    map.on('moveend', () => this.declutter());
  }

  /** Labels that would overlap another label or dot move to the left of their dot, or are hidden. */
  declutter(): void {
    if (this.declutterQueued) return;
    this.declutterQueued = true;
    requestAnimationFrame(() => {
      this.declutterQueued = false;
      const taken: DOMRect[] = [];
      const hits = (r: DOMRect) => taken.some((b) => !(r.right < b.left || r.left > b.right || r.bottom < b.top || r.top > b.bottom));
      const items = [...this.markers.values()].map((m) => m.marker.getElement());
      for (const node of items) taken.push(node.querySelector('.pin-dot')!.getBoundingClientRect());
      for (const node of items) {
        const label = node.querySelector<HTMLElement>('.pin-label')!;
        label.classList.remove('flip', 'hidden');
        let r = label.getBoundingClientRect();
        if (hits(r)) {
          label.classList.add('flip');
          r = label.getBoundingClientRect();
          if (hits(r)) {
            label.classList.add('hidden');
            continue;
          }
        }
        taken.push(r);
      }
    });
  }

  sync(places: Place[], far: Set<Id>): void {
    const keep = new Set<Id>();
    for (const p of places) {
      if (!p.location || p.anyOf) continue; // an "any branch" place shows as its branches' dots instead
      keep.add(p.id);
      const key = `${p.name}|${p.category}|${far.has(p.id)}`;
      const cur = this.markers.get(p.id);
      if (cur && cur.key === key) {
        const ll = cur.marker.getLngLat();
        if (ll.lng !== p.location[0] || ll.lat !== p.location[1]) cur.marker.setLngLat(p.location);
        continue;
      }
      cur?.marker.remove();
      const node = el('pin', `<span class="pin-dot">${escapeHtml(CATEGORIES[p.category].glyph)}</span><span class="pin-label">${escapeHtml(p.name)}</span>`);
      node.title = `${p.name} (drag to move)`;
      const marker = new Marker({ element: node, anchor: 'center', draggable: true }).setLngLat(p.location).addTo(this.map);
      marker.on('dragend', () => {
        const ll = marker.getLngLat();
        this.onMove(p.id, [Math.round(ll.lng * 1e5) / 1e5, Math.round(ll.lat * 1e5) / 1e5]);
      });
      this.markers.set(p.id, { marker, key });
    }
    for (const [id, m] of this.markers) {
      if (!keep.has(id)) {
        m.marker.remove();
        this.markers.delete(id);
      }
    }
    this.declutter();
  }

  remove(): void {
    for (const m of this.markers.values()) m.marker.remove();
    this.markers.clear();
  }
}

/** The spot clicked on the map: a draggable pin. */
export class ProbeMarker {
  private marker: Marker | null = null;
  constructor(
    private map: MlMap,
    private onMove: (at: LonLat) => void,
  ) {}

  show(at: LonLat | null): void {
    if (!at) {
      this.marker?.remove();
      this.marker = null;
      return;
    }
    if (!this.marker) {
      const node = el('probe', '<span class="probe-dot"></span>');
      node.title = 'This spot (drag to move)';
      this.marker = new Marker({ element: node, anchor: 'bottom', draggable: true }).setLngLat(at).addTo(this.map);
      this.marker.on('dragend', () => {
        const ll = this.marker!.getLngLat();
        this.onMove([Math.round(ll.lng * 1e5) / 1e5, Math.round(ll.lat * 1e5) / 1e5]);
      });
    } else this.marker.setLngLat(at);
  }

  remove(): void {
    this.show(null);
  }
}

/** Shortlisted homes: a letter, and their weekly time once known ("A · 10:09"). */
export class CandidateMarkers {
  private markers = new Map<Id, { marker: Marker; label: HTMLSpanElement }>();
  constructor(private map: MlMap) {}

  sync(items: { id: Id; letter: string; location: LonLat; text: string; title: string; current: boolean }[]): void {
    const keep = new Set(items.map((i) => i.id));
    for (const [id, m] of this.markers) {
      if (!keep.has(id)) {
        m.marker.remove();
        this.markers.delete(id);
      }
    }
    for (const it of items) {
      let m = this.markers.get(it.id);
      if (!m) {
        const node = el('cand', '<span class="cand-label"></span>');
        const label = node.querySelector<HTMLSpanElement>('.cand-label')!;
        m = { marker: new Marker({ element: node, anchor: 'bottom' }).setLngLat(it.location).addTo(this.map), label };
        this.markers.set(it.id, m);
      }
      m.marker.setLngLat(it.location);
      m.marker.getElement().classList.toggle('cand-current', it.current);
      m.marker.getElement().title = it.title;
      m.label.textContent = it.text;
    }
  }

  remove(): void {
    for (const m of this.markers.values()) m.marker.remove();
    this.markers.clear();
  }
}

/** A star on the lowest-travel point (its value is in the summary and the hover readout). */
export class BestMarker {
  private marker: Marker | null = null;
  constructor(private map: MlMap) {}

  show(at: LonLat | null, minutes: number): void {
    if (!at) {
      this.marker?.remove();
      this.marker = null;
      return;
    }
    if (!this.marker) {
      const node = el('best', '<span class="best-star" aria-hidden="true">★</span>');
      this.marker = new Marker({ element: node, anchor: 'center' }).setLngLat(at).addTo(this.map);
    } else this.marker.setLngLat(at);
    this.marker.getElement().title = `The best spot: about ${fmtDuration(minutes)} of travel a week`;
  }

  remove(): void {
    this.marker?.remove();
    this.marker = null;
  }
}
