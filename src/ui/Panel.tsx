import { engine } from '../compute/engine';
import { fmtDuration, fmtHoursPerYear } from '../compute/format';
import { setScenario } from '../state/scenarioStore';
import { uiStore, type Tab } from '../state/uiStore';
import { useLook, useResult, useScenario, useUI } from './hooks';
import { PeopleBar } from './PeopleBar';
import { PlaceList } from './PlaceList';
import { RoutingNotice } from './RoutingStatus';
import { SettingsTab } from './SettingsTab';
import { ShortlistTab } from './ShortlistTab';
import { SpotCard } from './SpotCard';
import { Welcome } from './Welcome';

function Summary() {
  const frame = useResult((r) => r.frame);
  const empty = useResult((r) => r.empty);
  const people = useScenario((s) => s?.people ?? []);
  const warm = useLook() === 'warm';
  if (!frame) return empty === 'no-trips' ? <div className="summary summary-empty">Add a place you go, and where it is, to see the map.</div> : null;
  const bd = frame.best ? engine.breakdownAt(frame.best) : null;
  return (
    <div className="summary">
      <div className="summary-main">
        {warm ? 'Best area: ' : 'Best area ≈ '}
        <strong>{fmtDuration(frame.stats.min)}</strong> a week
      </div>
      <div className="summary-sub">
        {warm ? `About ${fmtDuration(frame.stats.min / 7)} a day` : fmtHoursPerYear(frame.stats.min)}
        {bd && people.length > 1 && ` · ${people.map((p) => `${p.name} ${fmtDuration(bd.persons.get(p.id) ?? 0)}`).join(' · ')}`}
      </div>
      <RoutingNotice />
    </div>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'places', label: 'Places & trips' },
  { id: 'shortlist', label: 'Shortlist' },
  { id: 'settings', label: 'Settings' },
];

export function Panel() {
  const scenario = useScenario((s) => s);
  const tab = useUI((u) => u.tab);
  return (
    <aside className="panel">
      <header className="panel-head">
        <h1 className="brand">
          <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z" />
          </svg>
          Where2Live
        </h1>
        {scenario && <span className="scenario-name">{scenario.name}</span>}
      </header>
      {!scenario ? (
        <Welcome />
      ) : (
        <>
          {scenario.demo && (
            <div className="demo-bar">
              <span>You’re looking at the demo</span>
              <button type="button" className="btn btn-primary" onClick={() => setScenario(null)}>
                Exit demo
              </button>
            </div>
          )}
          <Summary />
          <SpotCard />
          <PeopleBar people={scenario.people} />
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => uiStore.setState({ tab: t.id })}>
                {t.label}
                {t.id === 'shortlist' && scenario.candidates.length > 0 && <span className="count">{scenario.candidates.length}</span>}
              </button>
            ))}
          </nav>
          <div className="tab-body">
            {tab === 'settings' ? <SettingsTab scenario={scenario} /> : tab === 'shortlist' ? <ShortlistTab scenario={scenario} /> : <PlaceList scenario={scenario} />}
          </div>
        </>
      )}
    </aside>
  );
}
