import type { Person } from '../domain/types';
import { addPerson, removePerson, updatePerson } from './actions';

export function PeopleBar({ people }: { people: Person[] }) {
  return (
    <div className="people" role="group" aria-label="Who’s moving">
      {people.map((p) => (
        <span key={p.id} className="person" style={{ ['--c' as string]: p.colour }}>
          <i aria-hidden="true" />
          <input value={p.name} aria-label="Name" size={Math.max(3, p.name.length)} onChange={(e) => updatePerson(p.id, { name: e.target.value })} />
          {people.length > 1 && (
            <button type="button" className="icon-btn" aria-label={`Remove ${p.name}`} title={`Remove ${p.name}`} onClick={() => removePerson(p.id)}>
              ×
            </button>
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
