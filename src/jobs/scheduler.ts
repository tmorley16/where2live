import type { OrsErrorKind } from '../routing/ors/client';
import { SlidingWindow } from './limiter';

export interface Task {
  id: string;
  /** Which rate limit it counts against. */
  kind: 'snap' | 'matrix';
  /** Higher runs first. */
  priority: number;
  attempt?: number;
  /** Not before this time (epoch ms): set by back-off. */
  notBefore?: number;
}

export interface SchedulerStatus {
  queued: number;
  running: number;
  done: number;
  failed: number;
  /** Why nothing is running although work is queued. */
  waiting: null | { reason: 'rate' | 'quota' | 'auth' | 'offline' | 'held'; until?: number };
}

export interface SchedulerHooks<T extends Task> {
  /** Runs a task. May return follow-up tasks (a split after a bad response). */
  run(task: T, signal: AbortSignal): Promise<T[] | void>;
  /** Splits a task too big or too awkward for the server, or null to give up. */
  split(task: T, kind: OrsErrorKind): T[] | null;
  /** The task is given up. */
  fail(task: T, error: unknown): void;
  status(s: SchedulerStatus): void;
}

const BACKOFF = [2000, 8000, 30000];

function errorKind(e: unknown): OrsErrorKind | 'abort' | 'unknown' {
  if ((e as Error)?.name === 'AbortError') return 'abort';
  const k = (e as { kind?: unknown })?.kind;
  return typeof k === 'string' ? (k as OrsErrorKind) : 'unknown';
}

/**
 * Runs routing requests within the server's limits: a sliding per-minute window per endpoint, a few in flight,
 * back-off on errors, pauses for rate and daily limits, and splitting when a request is too big.
 */
export class Scheduler<T extends Task> {
  private queue: T[] = [];
  private inflight = new Map<string, { task: T; ctrl: AbortController }>();
  private limiters: Record<Task['kind'], SlidingWindow>;
  private pausedUntil = 0;
  private pauseReason: 'rate' | 'quota' | null = null;
  private blocked: 'auth' | 'offline' | null = null;
  private held = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private done = 0;
  private failed = 0;

  constructor(
    private hooks: SchedulerHooks<T>,
    limits: Record<Task['kind'], number> = { matrix: 38, snap: 90 },
    private concurrency = 3,
    private now: () => number = Date.now,
  ) {
    this.limiters = { matrix: new SlidingWindow(limits.matrix, now), snap: new SlidingWindow(limits.snap, now) };
    globalThis.addEventListener?.('online', () => {
      if (this.blocked === 'offline') {
        this.blocked = null;
        this.pump();
      }
    });
  }

  get idle(): boolean {
    return this.queue.length === 0 && this.inflight.size === 0;
  }

  has(id: string): boolean {
    return this.inflight.has(id) || this.queue.some((t) => t.id === id);
  }

  tasks(): T[] {
    return [...this.queue, ...[...this.inflight.values()].map((x) => x.task)];
  }

  add(tasks: T[]): void {
    if (this.idle) this.done = this.failed = 0;
    for (const t of tasks) if (!this.has(t.id)) this.queue.push(t);
    this.sort();
    this.pump();
  }

  /** Drops waiting tasks (and aborts running ones) that match. Returns them. */
  drop(match: (t: T) => boolean): T[] {
    const dropped = this.queue.filter(match);
    this.queue = this.queue.filter((t) => !match(t));
    for (const { task, ctrl } of this.inflight.values()) {
      if (match(task)) {
        ctrl.abort();
        dropped.push(task);
      }
    }
    this.pump();
    return dropped;
  }

  reprioritise(priority: (t: T) => number): void {
    for (const t of this.queue) t.priority = priority(t);
    this.sort();
  }

  hold(on: boolean): void {
    this.held = on;
    this.pump();
  }

  /**
   * Waits for a slot for a one-off request made outside the queue (exact times for the shortlist), so it
   * counts against the same per-minute window. Rejects if routing is blocked (bad key).
   */
  async acquire(kind: Task['kind']): Promise<void> {
    for (;;) {
      if (this.blocked === 'auth') throw Object.assign(new Error('Your routing key was rejected.'), { kind: 'auth' });
      const wait = Math.max(this.pausedUntil - this.now(), this.limiters[kind].waitMs());
      if (wait <= 0) {
        this.limiters[kind].take();
        return;
      }
      await new Promise((r) => setTimeout(r, Math.min(wait, 5000)));
    }
  }

  /** After a new key, or to retry now. */
  resume(): void {
    this.blocked = null;
    this.pausedUntil = 0;
    this.pauseReason = null;
    this.pump();
  }

  private sort() {
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  private emit() {
    const queued = this.queue.length;
    const waiting: SchedulerStatus['waiting'] = !queued
      ? null
      : this.blocked
        ? { reason: this.blocked }
        : this.held
          ? { reason: 'held' }
          : this.pausedUntil > this.now()
            ? { reason: this.pauseReason ?? 'rate', until: this.pausedUntil }
            : null;
    this.hooks.status({ queued, running: this.inflight.size, done: this.done, failed: this.failed, waiting });
  }

  private pump(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.blocked || this.held) return this.emit();
    while (this.inflight.size < this.concurrency && this.queue.length) {
      const now = this.now();
      if (this.pausedUntil > now) {
        this.timer = setTimeout(() => this.pump(), this.pausedUntil - now);
        break;
      }
      // The highest-priority task that may go now.
      let pick = -1;
      let soonest = Infinity;
      for (let i = 0; i < this.queue.length; i++) {
        const t = this.queue[i];
        const wait = Math.max((t.notBefore ?? 0) - now, this.limiters[t.kind].waitMs());
        if (wait <= 0) {
          pick = i;
          break;
        }
        soonest = Math.min(soonest, wait);
      }
      if (pick < 0) {
        this.timer = setTimeout(() => this.pump(), Math.max(50, soonest));
        break;
      }
      const [task] = this.queue.splice(pick, 1);
      this.limiters[task.kind].take();
      void this.start(task);
    }
    this.emit();
  }

  private async start(task: T): Promise<void> {
    const ctrl = new AbortController();
    this.inflight.set(task.id, { task, ctrl });
    try {
      const more = await this.hooks.run(task, ctrl.signal);
      this.done++;
      if (more?.length) {
        for (const t of more) if (!this.has(t.id)) this.queue.push(t);
        this.sort();
      }
    } catch (e) {
      this.handle(task, e);
    } finally {
      this.inflight.delete(task.id);
      this.pump();
    }
  }

  private requeue(task: T, delay = 0) {
    task.notBefore = delay ? this.now() + delay : undefined;
    this.queue.push(task);
    this.sort();
  }

  private handle(task: T, e: unknown): void {
    const kind = errorKind(e);
    const quotaReset = (e as { quota?: { resetAt: number | null } })?.quota?.resetAt ?? null;
    switch (kind) {
      case 'abort':
        return;
      case 'rate':
        this.pausedUntil = Math.max(this.pausedUntil, quotaReset && quotaReset - this.now() < 120_000 ? quotaReset : this.now() + 60_000);
        this.pauseReason = 'rate';
        return this.requeue(task);
      case 'quota':
        this.pausedUntil = Math.max(this.pausedUntil, quotaReset ?? this.now() + 3600_000);
        this.pauseReason = 'quota';
        return this.requeue(task);
      case 'auth':
        this.blocked = 'auth';
        return this.requeue(task);
      case 'network':
      case 'server': {
        if (kind === 'network' && globalThis.navigator?.onLine === false) {
          this.blocked = 'offline';
          return this.requeue(task);
        }
        const attempt = (task.attempt ?? 0) + 1;
        if (attempt <= BACKOFF.length) {
          task.attempt = attempt;
          return this.requeue(task, BACKOFF[attempt - 1] * (0.75 + Math.random() * 0.5));
        }
        break;
      }
      case 'too-big':
      case 'too-far':
      case 'out-of-bounds': {
        const parts = this.hooks.split(task, kind);
        if (parts) {
          for (const p of parts) this.queue.push(p);
          this.sort();
          return;
        }
        break;
      }
    }
    this.failed++;
    this.hooks.fail(task, e);
  }
}
