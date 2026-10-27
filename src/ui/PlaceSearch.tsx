import { useEffect, useRef, useState } from 'react';
import type { LonLat } from '../domain/types';
import { searchCredit, searchPlaces } from '../routing/geocode';
import { parseCoordinates, type GeocodeResult } from '../routing/photon';

/**
 * Address search with suggestions as you type (openrouteservice with a key, Photon without), keyboard friendly. Also takes pasted coordinates
 * ("-33.87, 151.21", as Google Maps copies them).
 */
export function PlaceSearch({
  near,
  country,
  onChoose,
  placeholder = 'Search for an address or place',
  autoFocus,
  onCancel,
}: {
  near: LonLat;
  country?: string;
  onChoose: (r: GeocodeResult) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onCancel?: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<'idle' | 'busy' | 'none' | 'error'>('idle');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const text = q.trim();
    const coords = parseCoordinates(text);
    if (coords) {
      setResults([{ label: `${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}`, name: 'Pinned spot', location: coords }]);
      setStatus('idle');
      return;
    }
    if (text.length < 3) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setStatus('busy');
      searchPlaces(text, near, country, ctrl.signal)
        .then((r) => {
          setResults(r);
          setActive(0);
          setStatus(r.length ? 'idle' : 'none');
        })
        .catch((e: unknown) => {
          if ((e as Error).name !== 'AbortError') setStatus('error');
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, near[0], near[1], country]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (r: GeocodeResult) => {
    onChoose(r);
    setQ('');
    setResults([]);
  };

  return (
    <div className="search">
      <input
        ref={input}
        type="search"
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-autocomplete="list"
        aria-expanded={results.length > 0}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === 'Escape') {
            if (q) setQ('');
            else onCancel?.();
          }
        }}
      />
      {(results.length > 0 || status !== 'idle') && q.trim().length >= 3 && (
        <ul className="search-results" role="listbox">
          {results.map((r, i) => (
            <li key={`${r.label}${i}`} role="option" aria-selected={i === active} className={i === active ? 'active' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r)} onMouseEnter={() => setActive(i)}>
              {r.label}
            </li>
          ))}
          {status === 'busy' && results.length === 0 && <li className="search-note">Searching…</li>}
          {status === 'none' && <li className="search-note">Nothing found. Try a suburb, or pick the spot on the map.</li>}
          {status === 'error' && <li className="search-note">Search isn’t available right now. Pick the spot on the map instead.</li>}
          <li className="search-credit">{searchCredit()}</li>
        </ul>
      )}
    </div>
  );
}
