import { useState } from 'react';
import { SYDNEY } from '../domain/presets';
import { loadDemo, startOwn } from './actions';
import { PlaceSearch } from './PlaceSearch';

export function Welcome() {
  const [step, setStep] = useState<'intro' | 'where'>('intro');
  return (
    <div className="welcome">
      <h2>Where should you live?</h2>
      <p>
        Add the places you go regularly (work, church, the gym, the shops, friends) with who goes, how often and how. Where2Live works out the total
        weekly travel time from every possible home and shades the map, so you can see where you’d spend the least time getting around.
      </p>
      <ol className="steps">
        <li>Add your places and how often each of you goes.</li>
        <li>See the map shaded by hours of travel a week.</li>
        <li>Change anything: the map updates straight away.</li>
      </ol>
      {step === 'intro' ? (
        <div className="welcome-actions">
          <button type="button" className="btn btn-primary" onClick={loadDemo}>
            Try the demo
          </button>
          <button type="button" className="btn" onClick={() => setStep('where')}>
            Start with my own places
          </button>
        </div>
      ) : (
        <div className="welcome-where">
          <label className="field-label">Where are you looking?</label>
          <PlaceSearch near={SYDNEY} placeholder="A city or suburb" autoFocus onChoose={(r) => startOwn(r.location, r.country)} onCancel={() => setStep('intro')} />
          <button type="button" className="link" onClick={() => startOwn()}>
            Skip
          </button>
        </div>
      )}
      <p className="small">Everything stays in your browser. The demo uses rough straight-line estimates; real road times need a free routing key.</p>
    </div>
  );
}
