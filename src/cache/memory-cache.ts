/**
 * In-memory TTL cache with bounded size (oldest-insertion eviction).
 * Used for read/list responses only; report workflows are never cached.
 */
export class TtlCache<V = unknown> {
  private store = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    if (ttlMs <= 0) return;
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
