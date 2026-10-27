/** A sliding one-minute window, like the server's: at most `perMinute` requests in any 60 seconds. */
export class SlidingWindow {
  private times: number[] = [];
  constructor(
    readonly perMinute: number,
    private now: () => number = Date.now,
  ) {}

  /** Milliseconds to wait before the next request may go. */
  waitMs(): number {
    const t = this.now();
    while (this.times.length && t - this.times[0] >= 60_000) this.times.shift();
    return this.times.length < this.perMinute ? 0 : this.times[0] + 60_000 - t;
  }

  take(): void {
    this.times.push(this.now());
  }
}
