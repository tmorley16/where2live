import { useState } from 'react';
import { PERSON_COLOURS } from '../domain/presets';
import type { Id, Person } from '../domain/types';
import { addPerson, removePerson, updatePerson } from './actions';

export function PeopleBar({ people }: { people: Person[] }) {
  const [picking, setPicking] = useState<Id | null>(null);
  return (
    <div className="people" role="group" aria-label="Who’s moving">
      {people.map((p) => (
        <span key={p.id} className="person" style={{ ['--c' as string]: p.colour }}>
          <button type="button" className="person-colour" aria-label={`${p.name}’s colour`} aria-expanded={picking === p.id} title="Change colour" onClick={() => setPicking(picking === p.id ? null : p.id)} />
          <input value={p.name} aria-label="Name" size={Math.max(3, p.name.length)} onChange={(e) => updatePerson(p.id, { name: e.target.value })} />
          {people.length > 1 && (
            <button type="button" className="icon-btn" aria-label={`Remove ${p.name}`} title={`Remove ${p.name}`} onClick={() => removePerson(p.id)}>
              ×
            </button>
          )}
          {picking === p.id && (
            <span className="swatches" role="group" aria-label={`Colour for ${p.name}`}>
              {PERSON_COLOURS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`swatch-btn${c === p.colour ? ' on' : ''}`}
                  style={{ background: c }}
                  aria-label={`Colour ${c}`}
                  aria-pressed={c === p.colour}
                  onClick={() => {
                    updatePerson(p.id, { colour: c });
                    setPicking(null);
                  }}
                />
              ))}
            </span>
          )}
        </span>
      ))}
      {people.length < 5 && (
        <button type="button" className="link" onClick={addPerson}>
          + Person
        </button>
      )}
    </div>
  );
}
