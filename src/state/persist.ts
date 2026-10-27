/** localStorage helpers that never throw (private windows, blocked storage, Node tests). */

export function loadJSON<T>(key: string): T | null {
  try {
    const s = globalThis.localStorage?.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full */
  }
}

export function removeKey(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* ignore */
  }
}

export interface Debounced {
  (): void;
  flush(): void;
}

export function debounce(fn: () => void, ms: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  const run = (() => {
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      pending = false;
      fn();
    }, ms);
  }) as Debounced;
  run.flush = () => {
    clearTimeout(timer);
    if (pending) {
      pending = false;
      fn();
    }
  };
  return run;
}
