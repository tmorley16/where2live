import { useRef, useState } from 'react';
import { fmtTimes } from '../compute/overall';
import { PALETTES } from '../compute/palettes';
import { BAND_ORDER, TIME_BANDS } from '../domain/modes';
import type { BandStyle, PaletteId, Scenario } from '../domain/types';
import { parseScenario } from '../domain/validate';
import { edit, setScenario } from '../state/scenarioStore';
import { LOOK_PALETTE, lookStore, setLook, type Look } from '../state/look';
import { requestFit } from '../state/uiStore';
import { exportScenario, loadDemo, startOwn, setAreaAuto, setAreaToView } from './actions';
import { Row, Seg, Switch } from './controls';
import { routing } from '../routing/wire';
import { useApp, useLook } from './hooks';
import { openKeyDialog } from './KeyDialog';

const STEP_CHOICES = ['auto', 10, 15, 20, 30, 45, 60, 90, 120] as const;

/** Switching look also swaps the map colours, unless they were changed by hand. */
function chooseLook(look: Look): void {
  const before = LOOK_PALETTE[lookStore.getState().look];
  setLook(look);
  edit((d) => {
    if (d.settings.display.palette === before) d.settings.display.palette = LOOK_PALETTE[look];
  });
}

function LookSetting() {
  const look = useLook();
  return (
    <Row label="Look" hint="Warm and friendly, or clean and plain. Just for this browser.">
      <Seg<Look>
        label="Look"
        small
        value={look}
        options={[
          { id: 'warm', label: 'Warm' },
          { id: 'clean', label: 'Clean' },
        ]}
        onChange={chooseLook}
      />
    </Row>
  );
}

function RoutingSettings() {
  const key = useApp((a) => a.key);
  const left = useApp((a) => a.quota.matrix);
  const job = useApp((a) => a.job);
  return (
    <>
      <h3>Road times</h3>
      <Row
        label={key ? 'openrouteservice' : 'Estimates only'}
        hint={key ? (left ? `${left.remaining} travel-time requests left today` : 'Connected with your key') : 'Add your free key for real driving, cycling and walking times'}
      >
        <button type="button" className="btn btn-sm" onClick={openKeyDialog}>
          {key ? 'Change key' : 'Add key'}
        </button>
      </Row>
      {key && (
        <Row label="Saved road times" hint="Kept in this browser for 60 days, so maps reload without using your quota">
          <span className="inline">
            {(job.state === 'error' || job.state === 'declined') && (
              <button type="button" className="btn btn-sm" onClick={() => routing()?.retry()}>
                Retry
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={() => window.confirm('Forget every saved road time and fetch them again? This uses your daily quota.') && void routing()?.clearCache()}>
              Refresh
            </button>
          </span>
        </Row>
      )}
    </>
  );
}

export function SettingsTab({ scenario }: { scenario: Scenario }) {
  const st = scenario.settings;
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const confirmReplace = (what: string) => scenario.places.length === 0 || window.confirm(`${what}? Your current places will be replaced. Export them first if you want to keep them.`);

  return (
    <div className="settings">
      <RoutingSettings />
      <Row label="Supermarkets and chains" hint="Road times only for the better 40% of the map (far fewer requests; elsewhere the estimate), or everywhere">
        <Seg
          label="Supermarkets and chains"
          small
          value={st.branchRouting}
          options={[
            { id: 'focus', label: 'Best part' },
            { id: 'all', label: 'Everywhere' },
          ]}
          onChange={(v) => edit((d) => void (d.settings.branchRouting = v))}
        />
      </Row>
      <h3>Map</h3>
      <LookSetting />
      <Row label="Style">
        <Seg<BandStyle>
          label="Style"
          small
          value={st.display.style}
          options={[
            { id: 'bands', label: 'Bands' },
            { id: 'cells', label: 'Cells' },
            { id: 'smooth', label: 'Smooth' },
          ]}
          onChange={(v) => edit((d) => void (d.settings.display.style = v))}
        />
      </Row>
      <Row label="Colours">
        <Seg<PaletteId>
          label="Colours"
          small
          value={st.display.palette}
          options={(Object.keys(PALETTES) as PaletteId[]).map((id) => ({
            id,
            title: PALETTES[id].label,
            label: (
              <span className="ramp" aria-label={PALETTES[id].label}>
                {PALETTES[id].colours.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
            ),
          }))}
          onChange={(v) => edit((d) => void (d.settings.display.palette = v))}
        />
      </Row>
      <Row label="Overall view shows" hint="Ranking: the best 5%, 10%… of spots. Total: your hours, faded where it’s uneven.">
        <Seg
          label="Overall view shows"
          small
          value={st.display.overall}
          options={[
            { id: 'ranked', label: 'Ranking' },
            { id: 'faded', label: 'Total, faded if uneven' },
          ]}
          onChange={(v) => edit((d) => void (d.settings.display.overall = v))}
        />
      </Row>
      {st.display.overall === 'faded' && (
        <Row label="Fade where one of you travels over" hint="this many times as much as the other">
          <Seg
            label="Fade where one of you travels over"
            small
            value={String(st.display.uneven)}
            options={[1.5, 2, 3].map((x) => ({ id: String(x), label: fmtTimes(x) }))}
            onChange={(v) => edit((d) => void (d.settings.display.uneven = Number(v)))}
          />
        </Row>
      )}
      <Row label="Strength">
        <input type="range" min={0.3} max={0.9} step={0.05} value={st.display.opacity} aria-label="Strength" onChange={(e) => edit((d) => void (d.settings.display.opacity = Number(e.target.value)))} />
      </Row>
      <Row label="Band edges" hint="Thin lines between bands">
        <Switch checked={st.display.edges} label="Band edges" onChange={(v) => edit((d) => void (d.settings.display.edges = v))} />
      </Row>
      <Row label="Bands show" hint="Relative: the extra time compared with the best spot">
        <Seg
          label="Bands show"
          small
          value={st.bands.mode}
          options={[
            { id: 'absolute', label: 'Hours a week' },
            { id: 'relative', label: 'Extra vs best' },
          ]}
          onChange={(v) => edit((d) => void (d.settings.bands.mode = v))}
        />
      </Row>
      {st.bands.mode === 'absolute' && (
        <Row label="Band width">
          <select value={String(st.bands.step)} aria-label="Band width" onChange={(e) => edit((d) => void (d.settings.bands.step = e.target.value === 'auto' ? 'auto' : Number(e.target.value)))}>
            {STEP_CHOICES.map((c) => (
              <option key={c} value={String(c)}>
                {c === 'auto' ? 'Automatic' : `${c} min`}
              </option>
            ))}
          </select>
        </Row>
      )}

      <h3>Counting</h3>
      <Row label="Shared trips" hint="Two of you in one car: count both people’s time, or the trip once">
        <Seg
          label="Shared trips"
          small
          value={st.accounting}
          options={[
            { id: 'per-person', label: 'Each person' },
            { id: 'household', label: 'Once' },
          ]}
          onChange={(v) => edit((d) => void (d.settings.accounting = v))}
        />
      </Row>

      <h3>Traffic</h3>
      <p className="hint">Road times assume traffic is flowing freely. These stretch car trips by when you usually travel.</p>
      {BAND_ORDER.map((b) => (
        <Row key={b} label={TIME_BANDS[b].label} hint={TIME_BANDS[b].hint}>
          <span className="inline">
            ×
            <input
              type="number"
              className="num"
              min={0.5}
              max={4}
              step={0.05}
              value={st.trafficMultipliers[b]}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) edit((d) => void (d.settings.trafficMultipliers[b] = v));
              }}
            />
          </span>
        </Row>
      ))}
      <Row label="Same time both ways" hint="Use the time there for the trip back too. Halves the routing requests.">
        <span className="inline">
          Car <Switch checked={st.symmetric.car} label="Car: same time both ways" onChange={(v) => edit((d) => void (d.settings.symmetric.car = v))} />
          Bike <Switch checked={st.symmetric.bike} label="Bike: same time both ways" onChange={(v) => edit((d) => void (d.settings.symmetric.bike = v))} />
        </span>
      </Row>

      <h3>Search area</h3>
      <Row label="Area" hint={st.area.mode === 'auto' ? 'Chosen from your places' : 'The map view you chose'}>
        <span className="inline">
          {st.area.mode === 'manual' && (
            <button type="button" className="btn btn-sm" onClick={setAreaAuto}>
              Automatic
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={() => setMessage(setAreaToView() ? null : 'Move the map first.')}>
            Use this map view
          </button>
          <button type="button" className="btn btn-sm" onClick={requestFit}>
            Fit
          </button>
        </span>
      </Row>

      <h3>Your places</h3>
      <p className="hint">Saved in this browser only. Export a file to share with your partner or move to another device.</p>
      <div className="inline wrap">
        <button type="button" className="btn btn-sm" onClick={exportScenario}>
          Export
        </button>
        <button type="button" className="btn btn-sm" onClick={() => file.current?.click()}>
          Import
        </button>
        <button type="button" className="btn btn-sm" onClick={() => confirmReplace('Load the demo') && loadDemo()}>
          Load the demo
        </button>
        <button type="button" className="btn btn-sm" onClick={() => confirmReplace('Start again') && startOwn(scenario.region.centre, scenario.region.country)}>
          Start again
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const parsed = parseScenario(JSON.parse(await f.text()));
              if (!parsed) throw new Error('not a scenario');
              if (!confirmReplace('Import this file')) return;
              setScenario(parsed);
              requestFit();
              setMessage(`Imported “${parsed.name}”.`);
            } catch {
              setMessage('That file isn’t a Where2Live export.');
            }
          }}
        />
      </div>
      {message && <p className="hint">{message}</p>}
    </div>
  );
}
