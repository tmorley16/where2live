import { useEffect, useRef, useState } from 'react';
import { SYDNEY } from '../domain/presets';
import { OrsError } from '../routing/ors/client';
import { snapDistances } from '../routing/ors/snap';
import { appStore, noteQuota, setKey } from '../state/appStore';
import { getScenario } from '../state/scenarioStore';
import { uiStore } from '../state/uiStore';
import { useApp, useUI } from './hooks';

export function openKeyDialog(): void {
  uiStore.setState({ keyDialog: true });
}

export function KeyDialog() {
  const open = useUI((u) => u.keyDialog);
  const saved = useApp((a) => a.key);
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState('');
  const [remember, setRemember] = useState(true);
  const [test, setTest] = useState<{ state: 'idle' | 'busy' | 'ok' | 'bad'; message?: string }>({ state: 'idle' });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setValue(appStore.getState().key ?? '');
      setRemember(appStore.getState().remember);
      setTest({ state: 'idle' });
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const close = () => uiStore.setState({ keyDialog: false });

  const check = async (): Promise<boolean> => {
    const key = value.trim();
    if (!key) return false;
    setTest({ state: 'busy' });
    try {
      const { quota } = await snapDistances('driving-car', [getScenario()?.region.centre ?? SYDNEY], 300, key);
      noteQuota('snap', quota);
      setTest({ state: 'ok', message: 'That works.' });
      return true;
    } catch (e) {
      const kind = e instanceof OrsError ? e.kind : 'other';
      setTest({
        state: 'bad',
        message:
          kind === 'auth'
            ? 'That key was rejected. Check you copied all of it (no spaces).'
            : kind === 'network'
              ? 'Can’t reach openrouteservice. Check your connection.'
              : kind === 'quota'
                ? 'The key works, but today’s free quota is used up. It resets within 24 hours.'
                : `Something went wrong: ${(e as Error).message}`,
      });
      return kind === 'quota';
    }
  };

  return (
    <dialog ref={ref} className="dialog" onClose={close} aria-labelledby="key-title">
      <form
        method="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          if (test.state === 'ok' || (await check())) {
            setKey(value, remember);
            close();
          }
        }}
      >
        <h2 id="key-title">Real road travel times</h2>
        <p>
          Where2Live gets driving, cycling and walking times from <strong>openrouteservice</strong>, a free routing service run by HeiGIT in Heidelberg. You need your own free key, which takes
          about two minutes:
        </p>
        <ol>
          <li>
            Sign up at{' '}
            <a href="https://account.heigit.org" target="_blank" rel="noreferrer">
              account.heigit.org
            </a>{' '}
            (the free Standard plan).
          </li>
          <li>Copy your API key (token) from your dashboard.</li>
          <li>Paste it here.</li>
        </ol>
        <input
          className="key-input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setTest({ state: 'idle' });
          }}
          placeholder="Your openrouteservice key"
          aria-label="Your openrouteservice key"
          spellCheck={false}
          autoComplete="off"
          autoFocus
        />
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember on this device
        </label>
        {test.message && <p className={test.state === 'ok' ? 'ok-note' : 'notice'}>{test.message}</p>}
        <p className="small">
          The key stays in this browser and is only ever sent to api.heigit.org. The free plan allows 500 travel-time requests a day. A typical map takes about 40, and every result is saved
          here, so you never pay for the same thing twice.
        </p>
        <div className="dialog-actions">
          {saved && (
            <button
              type="button"
              className="link danger"
              onClick={() => {
                setKey(null, true);
                close();
              }}
            >
              Remove key
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={!value.trim() || test.state === 'busy'} onClick={() => void check()}>
            {test.state === 'busy' ? 'Testing…' : 'Test'}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim() || test.state === 'busy'}>
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}
