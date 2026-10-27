import { useEffect, useState } from 'react';
import { fmtDuration } from '../compute/format';
import { routing } from '../routing/wire';
import { useApp, useResult } from './hooks';
import { openKeyDialog } from './KeyDialog';

function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

/** The notice in the summary: estimates vs road times, and the "ask before a big batch" card. */
export function RoutingNotice() {
  const key = useApp((a) => a.key);
  const job = useApp((a) => a.job);
  const estimate = useResult((r) => r.frame?.estimate ?? true);
  const provisional = useResult((r) => r.frame?.provisional ?? 0);
  if (!key)
    return (
      <div className="notice">
        Rough straight-line estimates for now.{' '}
        <button type="button" className="link" onClick={openKeyDialog}>
          Get real road times
        </button>
      </div>
    );
  if (job.state === 'confirm' && job.confirm) {
    const { requests, minutes, remaining } = job.confirm;
    return (
      <div className="confirm">
        <p>
          Real road times for this map need about <strong>{requests}</strong> requests
          {remaining !== null ? ` (${Math.round((requests / Math.max(1, remaining)) * 100)}% of the ${remaining} you have left today)` : ''} and about {Math.max(1, Math.round(minutes))} min. They’re saved, so this only
          happens once.
        </p>
        <div className="inline">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => routing()?.confirmBatch()}>
            Fetch road times
          </button>
          <button type="button" className="btn btn-sm" onClick={() => routing()?.declineBatch()}>
            Not now
          </button>
        </div>
      </div>
    );
  }
  if (job.state === 'declined')
    return (
      <div className="notice">
        Showing estimates.{' '}
        <button type="button" className="link" onClick={() => routing()?.retry()}>
          Fetch road times
        </button>
      </div>
    );
  if (job.state === 'auth')
    return (
      <div className="notice">
        Your routing key was rejected.{' '}
        <button type="button" className="link" onClick={openKeyDialog}>
          Check it
        </button>
      </div>
    );
  if (estimate || provisional > 0) return <div className="notice notice-quiet">Updating with real road times…</div>;
  return null;
}

/** The chip on the map while fetching. */
export function RoutingChip() {
  const key = useApp((a) => a.key);
  const job = useApp((a) => a.job);
  const left = useApp((a) => a.quota.matrix?.remaining);
  useTick(job.state === 'waiting');
  if (!key) return null;
  switch (job.state) {
    case 'running':
      return (
        <div className="chip chip-busy" role="status">
          <span className="spinner" aria-hidden="true" />
          Fetching road times · {job.todo} to go{left !== undefined ? ` · ${left} left today` : ''}
        </div>
      );
    case 'waiting':
      return (
        <div className="chip" role="status">
          Pausing for the per-minute limit · {fmtDuration(Math.max(0, ((job.until ?? Date.now()) - Date.now()) / 60000))}
        </div>
      );
    case 'paused-quota':
      return (
        <div className="chip" role="status">
          Today’s free quota is used up · resumes {job.until ? `about ${clock(job.until)}` : 'tomorrow'}
        </div>
      );
    case 'offline':
      return (
        <div className="chip" role="status">
          Offline · carries on when you’re back
        </div>
      );
    case 'error':
      return (
        <button type="button" className="chip chip-btn" onClick={() => routing()?.retry()}>
          Some road times couldn’t be fetched · Retry
        </button>
      );
    default:
      return null;
  }
}
