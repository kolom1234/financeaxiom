import { describe, expect, it } from "vitest";
import { RateLimiterDO } from "../../src/do/rateLimiter";

function createLimiter(): RateLimiterDO {
  return new RateLimiterDO({} as DurableObjectState);
}

describe("RateLimiterDO", () => {
  it("rejects malformed requests", async () => {
    const limiter = createLimiter();

    const wrongMethod = await limiter.fetch(new Request("https://internal/check"));
    expect(wrongMethod.status).toBe(404);

    const invalidBody = await limiter.fetch(
      new Request("https://internal/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 0, windowMs: 60_000 })
      })
    );
    expect(invalidBody.status).toBe(400);
  });

  it("enforces fixed-window limits per instance", async () => {
    const limiter = createLimiter();
    const body = JSON.stringify({
      limit: 2,
      windowMs: 10_000,
      nowMs: 1_000
    });

    const first = await limiter.fetch(
      new Request("https://internal/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      })
    );
    expect(first.status).toBe(200);
    expect((await first.json()).allowed).toBe(true);

    const second = await limiter.fetch(
      new Request("https://internal/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      })
    );
    expect(second.status).toBe(200);
    expect((await second.json()).allowed).toBe(true);

    const third = await limiter.fetch(
      new Request("https://internal/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      })
    );
    expect(third.status).toBe(200);
    const thirdPayload = await third.json();
    expect(thirdPayload.allowed).toBe(false);
    expect(thirdPayload.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets counters on a new window", async () => {
    const limiter = createLimiter();

    await limiter.fetch(
      new Request("https://internal/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          limit: 1,
          windowMs: 1_000,
          nowMs: 100
        })
      })
    );

    const blocked = await limiter.fetch(
      new Request("https://internal/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          limit: 1,
          windowMs: 1_000,
          nowMs: 200
        })
      })
    );
    expect((await blocked.json()).allowed).toBe(false);

    const reopened = await limiter.fetch(
      new Request("https://internal/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          limit: 1,
          windowMs: 1_000,
          nowMs: 1_100
        })
      })
    );
    expect((await reopened.json()).allowed).toBe(true);
  });
});

