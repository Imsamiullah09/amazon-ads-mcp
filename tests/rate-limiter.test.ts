import { describe, expect, it } from "vitest";
import { TokenBucket } from "../src/http/rate-limiter.js";

describe("TokenBucket", () => {
  it("allows burst up to capacity without waiting", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const bucket = new TokenBucket(
      3,
      1,
      () => t,
      async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    );
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    expect(sleeps).toHaveLength(0);
  });

  it("waits for refill once the bucket is drained", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const bucket = new TokenBucket(
      1,
      2, // 2 tokens/sec → ~500ms per token
      () => t,
      async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    );
    await bucket.acquire(); // consumes the initial token
    await bucket.acquire(); // must wait ~500ms
    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(450);
  });

  it("serves queued waiters in FIFO order", async () => {
    let t = 0;
    const order: number[] = [];
    const bucket = new TokenBucket(
      1,
      1000,
      () => t,
      async (ms) => {
        t += ms;
      },
    );
    await Promise.all([
      bucket.acquire().then(() => order.push(1)),
      bucket.acquire().then(() => order.push(2)),
      bucket.acquire().then(() => order.push(3)),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });
});
