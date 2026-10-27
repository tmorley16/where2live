import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlidingWindow } from '../../src/jobs/limiter';
import { Scheduler, type SchedulerStatus, type Task } from '../../src/jobs/scheduler';
import { OrsError } from '../../src/routing/ors/client';

interface T extends Task {
  n: number;
}

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

const task = (id: string, priority = 1, n = 100): T => ({ id, kind: 'matrix', priority, n });

function setup(run: (t: T) => Promise<T[] | void>, split: (t: T) => T[] | null = () => null, limits = { matrix: 38, snap: 90 }) {
  const ran: string[] = [];
  const failed: string[] = [];
  const status: SchedulerStatus[] = [];
  const s = new Scheduler<T>(
    {
      run: async (t) => {
        ran.push(t.id);
        return run(t);
      },
      split: (t) => split(t),
      fail: (t) => failed.push(t.id),
      status: (x) => status.push(x),
    },
    limits,
    3,
    () => Date.now(),
  );
  return { s, ran, failed, status };
}

describe('sliding window', () => {
  it('allows perMinute requests in any 60 s', () => {
    let t = 0;
    const w = new SlidingWindow(2, () => t);
    w.take();
    w.take();
    expect(w.waitMs()).toBe(60_000);
    t = 30_000;
    expect(w.waitMs()).toBe(30_000);
    t = 60_000;
    expect(w.waitMs()).toBe(0);
  });
});

describe('scheduler', () => {
  it('runs the highest priority first, at most 3 at once, within the per-minute limit', async () => {
    const { s, ran } = setup(async () => {}, undefined, { matrix: 4, snap: 90 });
    s.add([task('low', 1), task('high', 9), task('mid', 5), task('a', 1), task('b', 1)]);
    expect(ran.slice(0, 3)).toEqual(['high', 'mid', 'low']);
    await vi.advanceTimersByTimeAsync(10);
    expect(ran.length).toBe(4); // the 5th waits for the minute window
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ran.length).toBe(5);
  });

  it('pauses after a 429 and retries the same task', async () => {
    let first = true;
    const { s, ran, status } = setup(async () => {
      if (first) {
        first = false;
        throw new OrsError('rate', 'Rate limit', 429);
      }
    });
    s.add([task('x')]);
    await vi.advanceTimersByTimeAsync(10);
    expect(status.at(-1)?.waiting?.reason).toBe('rate');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ran).toEqual(['x', 'x']);
    expect(status.at(-1)?.done).toBe(1);
  });

  it('pauses until the reset after the daily limit, keeping the work', async () => {
    const reset = Date.now() + 3 * 3600_000;
    let calls = 0;
    const { s, status } = setup(async () => {
      calls++;
      if (calls === 1) throw new OrsError('quota', 'Quota exceeded', 403, undefined, { remaining: 0, resetAt: reset, seenAt: Date.now() });
    });
    s.add([task('x'), task('y')]);
    await vi.advanceTimersByTimeAsync(10);
    expect(status.at(-1)?.waiting).toMatchObject({ reason: 'quota', until: reset });
    await vi.advanceTimersByTimeAsync(3 * 3600_000);
    expect(status.at(-1)?.queued).toBe(0);
  });

  it('stops on a rejected key until resumed', async () => {
    let ok = false;
    const { s, status, ran } = setup(async () => {
      if (!ok) throw new OrsError('auth', 'Access to this API has been disallowed', 403);
    });
    s.add([task('x')]);
    await vi.advanceTimersByTimeAsync(10);
    expect(status.at(-1)?.waiting?.reason).toBe('auth');
    ok = true;
    s.resume();
    await vi.advanceTimersByTimeAsync(10);
    expect(ran).toEqual(['x', 'x']);
  });

  it('splits a request that is too big', async () => {
    const { s, ran } = setup(
      async (t) => {
        if (t.n > 50) throw new OrsError('too-big', 'Only a total of 3500 routes are allowed.', 400, 6004);
      },
      (t) => [{ ...t, id: `${t.id}a`, n: t.n / 2 }, { ...t, id: `${t.id}b`, n: t.n / 2 }],
    );
    s.add([task('x', 1, 100)]);
    await vi.advanceTimersByTimeAsync(10);
    expect(ran).toEqual(['x', 'xa', 'xb']);
  });

  it('backs off on server errors and gives up after three retries', async () => {
    const { s, ran, failed } = setup(async () => {
      throw new OrsError('server', 'Bad gateway', 502);
    });
    s.add([task('x')]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ran.length).toBe(4);
    expect(failed).toEqual(['x']);
  });

  it('drops waiting tasks that are no longer wanted', async () => {
    const { s, ran } = setup(() => new Promise(() => {}), undefined);
    s.add([task('a', 3), task('b', 2), task('c', 1), task('d', 0)]);
    const dropped = s.drop((t) => t.id === 'd' || t.id === 'a');
    expect(dropped.map((t) => t.id).sort()).toEqual(['a', 'd']);
    expect(ran).toEqual(['a', 'b', 'c']);
    expect(s.has('d')).toBe(false);
  });
});
