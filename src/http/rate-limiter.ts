/**
 * Token-bucket rate limiter.
 *
 * Amazon Ads enforces dynamic, undocumented per-account throttling and
 * answers violations with HTTP 429 + Retry-After. A client-side ceiling
 * keeps us well under typical limits and smooths bursts from parallel
 * tool calls; the retry layer handles whatever still gets through.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private queue: Array<() => void> = [];
  private draining = false;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {
    this.tokens = capacity;
    this.lastRefill = this.now();
  }

  private refill(): void {
    const elapsed = (this.now() - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.lastRefill = this.now();
  }

  /** Resolves when a token is available. FIFO-fair under contention. */
  async acquire(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        this.refill();
        if (this.tokens >= 1) {
          this.tokens -= 1;
          const next = this.queue.shift();
          next?.();
        } else {
          const deficitMs = ((1 - this.tokens) / this.refillPerSecond) * 1000;
          await this.sleep(Math.max(5, Math.ceil(deficitMs)));
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
