import { lazy, Suspense, useEffect } from 'react';
import { uiStore } from './state/uiStore';
import { KeyDialog } from './ui/KeyDialog';
import { Panel } from './ui/Panel';

const MapView = lazy(() => import('./map/MapView'));

export function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && uiStore.getState().picking) uiStore.setState({ picking: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="app">
      <Panel />
      <main className="map-area">
        <Suspense fallback={<div className="map-note">Loading the map…</div>}>
          <MapView />
        </Suspense>
      </main>
      <KeyDialog />
    </div>
  );
}
