import { useState } from 'react';
import { fmtDelta, fmtDuration } from '../compute/format';
import type { BandStyle, View } from '../domain/types';
import { edit } from '../state/scenarioStore';
import { requestFit } from '../state/uiStore';
import { useResult, useScenario, useUI } from '../ui/hooks';
import { RoutingChip } from '../ui/RoutingStatus';

function sameView(a: View, b: View): boolean {
  return a.kind === b.kind && (a.kind !== 'person' || (b.kind === 'person' && a.id === b.id));
}

function ViewSwitch() {
  const people = useScenario((s) => s?.people ?? []);
  const view = useScenario((s) => s?.settings.view);
  if (!view || people.length === 0) return null;
  const options: { view: View; label: string; hint: string }[] =
    people.length > 1
      ? [
          { view: { kind: 'balanced' }, label: 'Balanced', hint: 'Your total weekly travel plus half the gap between you: low where it’s short and fairly shared' },
          { view: { kind: 'combined' }, label: 'Total', hint: 'Everyone’s weekly travel added up' },
          { view: { kind: 'fairest' }, label: 'Fairest', hint: 'The busier person’s weekly travel: low where neither of you travels a lot' },
          ...people.map((p) => ({ view: { kind: 'person', id: p.id } as View, label: p.name, hint: `${p.name}’s own weekly travel` })),
        ]
      : [{ view: { kind: 'combined' }, label: 'Total', hint: 'Your weekly travel' }];
  // With one person every view is the total.
  const current: View = people.length > 1 ? view : { kind: 'combined' };
  return (
    <div className="seg" role="group" aria-label="Whose travel to show">
      {options.map((o) => (
        <button key={o.label} type="button" className={sameView(o.view, current) ? 'on' : ''} aria-pressed={sameView(o.view, current)} title={o.hint} onClick={() => edit((d) => void (d.settings.view = o.view))}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const STYLES: { id: BandStyle; label: string; hint: string }[] = [
  { id: 'bands', label: 'Bands', hint: 'Shaded bands, like a weather map' },
  { id: 'cells', label: 'Cells', hint: 'One square per point we calculated' },
  { id: 'smooth', label: 'Smooth', hint: 'A smooth colour ramp' },
];

function StyleSwitch() {
  const style = useScenario((s) => s?.settings.display.style);
  if (!style) return null;
  return (
    <div className="seg seg-sm" role="group" aria-label="Map style">
      {STYLES.map((o) => (
        <button key={o.id} type="button" className={o.id === style ? 'on' : ''} aria-pressed={o.id === style} title={o.hint} onClick={() => edit((d) => void (d.settings.display.style = o.id))}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const narrow = () => globalThis.matchMedia?.('(max-width: 760px)').matches ?? false;

function Legend() {
  const [open, setOpen] = useState(() => !narrow());
  const frame = useResult((r) => r.frame);
  const view = useScenario((s) => s?.settings.view);
  const people = useScenario((s) => s?.people ?? []);
  const places = useScenario((s) => s?.places ?? []);
  const accounting = useScenario((s) => s?.settings.accounting);
  if (!frame || !view || frame.bands.bands.length === 0) return null;
  const who =
    view.kind === 'person'
      ? `${people.find((p) => p.id === view.id)?.name ?? 'One person'}’s weekly travel`
      : view.kind === 'fairest' && people.length > 1
        ? 'The busier person’s weekly travel'
        : view.kind === 'balanced' && people.length > 1
          ? 'Weekly travel, plus half the gap between you'
          : people.length > 1
          ? accounting === 'household'
            ? 'Weekly travel, shared trips counted once'
            : 'Weekly travel, everyone added up'
          : 'Weekly travel';
  const far = frame.area.far.map((id) => places.find((p) => p.id === id)?.name).filter(Boolean);
  if (!open)
    return (
      <button type="button" className="legend legend-closed" aria-expanded={false} onClick={() => setOpen(true)} title="Show the legend">
        <span className="ramp">
          {frame.bands.bands.map((b) => (
            <i key={b.lower} style={{ background: b.colour }} />
          ))}
        </span>
        {fmtDuration(frame.bands.base)} – {fmtDuration(frame.bands.top)}
      </button>
    );
  return (
    <div className="legend" aria-label="Legend">
      <div className="legend-title">
        {who}
        <button type="button" className="icon-btn" aria-label="Hide the legend" aria-expanded={true} onClick={() => setOpen(false)}>
          –
        </button>
      </div>
      <ul className="legend-bands">
        {frame.bands.bands.map((b) => (
          <li key={b.lower}>
            <span className="swatch" style={{ background: b.colour }} />
            {b.label}
          </li>
        ))}
        <li className="legend-muted">
          <span className="swatch swatch-none" />
          Unshaded: over {fmtDuration(frame.bands.top)}, or no homes
        </li>
      </ul>
      {frame.estimate && <div className="legend-note badge-estimate">Rough estimates (straight-line distance)</div>}
      {far.length > 0 && <div className="legend-note">Also counted, outside the area: {far.join(', ')}</div>}
    </div>
  );
}

function HoverTip() {
  const hover = useUI((u) => u.hover);
  const best = useResult((r) => r.frame?.stats.min ?? Number.NaN);
  const people = useScenario((s) => s?.people ?? []);
  if (!hover) return null;
  const varies = hover.hi - hover.lo > 0.2 * hover.value;
  return (
    <div className="hovertip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
      <div className="hovertip-main">≈ {fmtDuration(hover.value)} a week</div>
      <div className="hovertip-sub">{fmtDelta(hover.value - best) === 'best' ? 'about the best there is' : `${fmtDelta(hover.value - best)} vs the best spot`}</div>
      {hover.breakdown && people.length > 1 && (
        <div className="hovertip-people">
          {people.map((p) => (
            <span key={p.id}>
              <i style={{ background: p.colour }} />
              {p.name} {fmtDuration(hover.breakdown!.persons.get(p.id) ?? 0)}
            </span>
          ))}
        </div>
      )}
      {varies && (
        <div className="hovertip-sub">
          Varies {fmtDuration(hover.lo)} – {fmtDuration(hover.hi)} around here
        </div>
      )}
    </div>
  );
}

function StatusChip() {
  const frame = useResult((r) => r.frame);
  const empty = useResult((r) => r.empty);
  const picking = useUI((u) => u.picking);
  if (picking) return <div className="chip chip-accent">Click the map to place it · Esc to cancel</div>;
  if (empty === 'no-trips') return <div className="chip">Add a place you go to see the map</div>;
  if (!frame) return null;
  return (
    <div className="chip chip-status">
      Best area ≈ <strong>{fmtDuration(frame.stats.min)}</strong> a week
    </div>
  );
}

export function MapOverlay() {
  const hasScenario = useScenario((s) => !!s);
  if (!hasScenario) return null;
  return (
    <>
      <div className="map-tl">
        <ViewSwitch />
        <StyleSwitch />
      </div>
      <div className="map-tr">
        <RoutingChip />
        <StatusChip />
        <button type="button" className="chip chip-btn" onClick={requestFit} title="Zoom to the whole search area">
          Fit area
        </button>
      </div>
      <div className="map-bl">
        <Legend />
      </div>
      <HoverTip />
    </>
  );
}
