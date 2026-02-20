import { describe, expect, it } from "vitest";
import { SlidingWindowPerSecondLimiter } from "../../src/services/rateLimiter";

describe("SlidingWindowPerSecondLimiter", () => {
  it("enforces max requests per second", () => {
    const limiter = new SlidingWindowPerSecondLimiter(10);
    const now = Date.now();
    const accepted = Array.from({ length: 15 }, (_, index) => limiter.acquire(now + index)).filter(Boolean).length;
    expect(accepted).toBe(10);
  });

  it("resets on next second", () => {
    const limiter = new SlidingWindowPerSecondLimiter(2);
    const now = Date.now();
    expect(limiter.acquire(now)).toBe(true);
    expect(limiter.acquire(now + 10)).toBe(true);
    expect(limiter.acquire(now + 20)).toBe(false);
    expect(limiter.acquire(now + 1500)).toBe(true);
  });
});

