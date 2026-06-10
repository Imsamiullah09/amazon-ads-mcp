import { describe, expect, it } from "vitest";
import { TtlCache } from "../src/cache/memory-cache.js";

describe("TtlCache", () => {
  it("returns values before expiry and drops them after", () => {
    let t = 0;
    const cache = new TtlCache<string>(10, () => t);
    cache.set("k", "v", 1000);
    expect(cache.get("k")).toBe("v");
    t = 1001;
    expect(cache.get("k")).toBeUndefined();
  });

  it("ignores set() with non-positive TTL", () => {
    const cache = new TtlCache<string>();
    cache.set("k", "v", 0);
    expect(cache.get("k")).toBeUndefined();
  });

  it("evicts oldest entry when full", () => {
    let t = 0;
    const cache = new TtlCache<number>(2, () => t);
    cache.set("a", 1, 10_000);
    cache.set("b", 2, 10_000);
    cache.set("c", 3, 10_000);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });
});
