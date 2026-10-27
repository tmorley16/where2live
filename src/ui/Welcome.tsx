import { useState } from 'react';
import { SYDNEY } from '../domain/presets';
import { loadDemo, startOwn } from './actions';
import { useLook } from './hooks';
import { PlaceSearch } from './PlaceSearch';

export function Welcome() {
  const [step, setStep] = useState<'intro' | 'where'>('intro');
  const warm = useLook() === 'warm';
  return (
    <div className="welcome">
      {warm ? (
        <>
          <h2>Where should we live?</h2>
          <p>
            Most weeks are made of the same trips: work, church, the gym, the shops, catching up with friends and family. Add yours, say who goes and how
            often, and Where2Live colours the map to show where home would leave you the most time for each other.
          </p>
          <ol className="steps">
            <li>Add the places your week revolves around.</li>
            <li>Watch the map colour in: greener means less time on the road.</li>
            <li>Change anything and see it update straight away.</li>
          </ol>
        </>
      ) : (
        <>
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
        </>
      )}
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
