import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/index";
import { createMockEnv } from "../helpers/mockEnv";
import { MemoryStore } from "../../src/services/store";
import { checkRateLimit, rateLimitKey } from "../../src/services/rateLimit";
import type { PushQueueMessage } from "../../src/types";

async function responseJson(response: Response): Promise<any> {
  return response.json();
}

function jsonResponse(status: number, payload?: unknown): Response {
  return new Response(JSON.stringify(payload ?? {}), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

const TEST_SUPABASE_URL = "https://example.supabase.co";
const TEST_SUPABASE_ANON_KEY = "test-anon-key";

describe("worker API routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles auth login through configured Supabase upstream", async () => {
    const env = createMockEnv({
      SUPABASE_URL: TEST_SUPABASE_URL,
      SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(200, {
        session: {
          access_token: "session-access",
          refresh_token: "session-refresh"
        }
      })
    );

    const response = await worker.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "Test@Example.COM ", password: "password123" })
      }),
      env
    );
    const payload = await responseJson(response);

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.access_token).toBe("session-access");
    expect(payload.data.refresh_token).toBe("session-refresh");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const requestUrl = fetchSpy.mock.calls[0]?.[0] as string;
    const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(requestUrl).toBe(`${TEST_SUPABASE_URL}/auth/v1/token?grant_type=password`);
    expect(requestInit.method).toBe("POST");
    expect(requestInit.headers).toMatchObject({
      "content-type": "application/json",
      apikey: TEST_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${TEST_SUPABASE_ANON_KEY}`
    });
    expect(JSON.parse(String(requestInit.body))).toEqual({
      email: "test@example.com",
      password: "password123"
    });
  });

  it("rejects auth login payload as non-object JSON", async () => {
    const env = createMockEnv({
      SUPABASE_URL: TEST_SUPABASE_URL,
      SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY
    });
    vi.spyOn(globalThis, "fetch");

    const response = await worker.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "\"just-string\""
      }),
      env
    );
    const payload = await responseJson(response);

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error.message).toMatch(/Request body must be a JSON object/);
  });

  it("rejects oversized auth payloads before upstream call", async () => {
    const env = createMockEnv({
      SUPABASE_URL: TEST_SUPABASE_URL,
      SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const large = "a".repeat(9_000);
    const response = await worker.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `test+${large}@example.com`, password: "password123" })
      }),
      env
    );
    const payload = await responseJson(response);

    expect(response.status).toBe(413);
    expect(payload.ok).toBe(false);
    expect(payload.error.message).toMatch(/Request payload is too large/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid auth login payload and does not call upstream", async () => {
    const env = createMockEnv({
      SUPABASE_URL: TEST_SUPABASE_URL,
      SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await worker.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "bad-email", password: "" })
      }),
      env
    );
    const payload = await responseJson(response);

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error.message).toMatch(/Invalid login payload/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps authentication service 5xx responses to proxy 502", async () => {
    const env = createMockEnv({
      SUPABASE_URL: TEST_SUPABASE_URL,
      SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(503, { error: "service unavailable" }));

    const response = await worker.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com", password: "password123" })
      }),
      env
    );
    const payload = await responseJson(response);

    expect(response.status).toBe(502);
    expect(payload.ok).toBe(false);
    expect(payload.error.message).toMatch(/service unavailable/);
  });

  it("handles timeout from auth upstream as 504", async () => {
    const env = createMockEnv({
      SUPABASE_URL: TEST_SUPABASE_URL,
      SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY
    });
    const timeoutErr = new Error("aborted");
    timeoutErr.name = "AbortError";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(timeoutErr);

    const response = await worker.fetch(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com", password: "password123" })
      }),
      env
    );
    const payload = await responseJson(response);

    expect(response.status).toBe(504);
    expect(payload.ok).toBe(false);
    expect(payload.error.message).toMatch(/timed out/);
  });

  it("retries timeout upstream errors for password reset and eventually succeeds", async () => {
    const env = createMockEnv({
      SUPABASE_URL: TEST_SUPABASE_URL,
      SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY
    });
    const timeoutErr = new Error("upstream timeout");
    timeoutErr.name = "AbortError";

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const response = await worker.fetch(
      new Request("http://localhost/api/auth/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com" })
      }),
      env
    );
    const payload = await responseJson(response);

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("supports signup success path and forwards normalized email + redirect", async () => {
    const env = createMockEnv({
      SUPABASE_URL: TEST_SUPABASE_URL,
      SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY,
      AUTH_ALLOWED_REDIRECT_ORIGINS: "https://financeaxiom.com"
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(200, {
        access_token: "signup-access",
        refresh_token: "signup-refresh"
      })
    );

    const response = await worker.fetch(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "USER@Example.Com",
          password: "newPassword123",
          redirect_to: "https://financeaxiom.com/alerts"
        })
      }),
      env
    );
    const payload = await responseJson(response);

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.access_token).toBe("signup-access");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const requestUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(requestUrl).toBe(`${TEST_SUPABASE_URL}/auth/v1/signup?redirect_to=https%3A%2F%2Ffinanceaxiom.com%2Falerts`);
    const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual({
      email: "user@example.com",
      password: "newPassword123"
    });
  });

  it("rejects signup redirect when origin is not allowlisted", async () => {
    const env = createMockEnv({
      SUPABASE_URL: TEST_SUPABASE_URL,
      SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY,
      AUTH_ALLOWED_REDIRECT_ORIGINS: "https://financeaxiom.com"
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await worker.fetch(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          password: "newPassword123",
          redirect_to: "https://evil.example/phish"
        })
      }),
      env
    );
    const payload = await responseJson(response);

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error.message).toMatch(/Invalid signup payload/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("supports password reset and password change without returning raw tokens", async () => {
    const env = createMockEnv({
      SUPABASE_URL: TEST_SUPABASE_URL,
      SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY,
      AUTH_ALLOWED_REDIRECT_ORIGINS: "https://financeaxiom.com"
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, { ok: true }));

    const resetResponse = await worker.fetch(
      new Request("http://localhost/api/auth/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          redirect_to: "https://financeaxiom.com/alerts"
        })
      }),
      env
    );
    const resetPayload = await responseJson(resetResponse);

    expect(resetResponse.status).toBe(200);
    expect(resetPayload.ok).toBe(true);
    expect(resetPayload.data.ok).toBe(true);
    const resetRequestUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(resetRequestUrl).toBe(
      `${TEST_SUPABASE_URL}/auth/v1/recover?redirect_to=https%3A%2F%2Ffinanceaxiom.com%2Falerts`
    );
    const resetRequestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(resetRequestInit.body))).toEqual({
      email: "user@example.com"
    });

    const changeResponse = await worker.fetch(
      new Request("http://localhost/api/auth/password-change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token: "access-token", new_password: "new-password-01" })
      }),
      env
    );
    const changePayload = await responseJson(changeResponse);

    expect(changeResponse.status).toBe(200);
    expect(changePayload.ok).toBe(true);
    expect(changePayload.data).toBeTruthy();
  });

  it("supports logout flow using bearer token and upstream 204", async () => {
    const env = createMockEnv({
      SUPABASE_URL: TEST_SUPABASE_URL,
      SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    const response = await worker.fetch(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token: "access-token" })
      }),
      env
    );
    const payload = await responseJson(response);

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.ok).toBe(true);
  });

  it("rate-limits repeated auth login attempts using shared kv", async () => {
    const env = createMockEnv({
      SUPABASE_URL: TEST_SUPABASE_URL,
      SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, { access_token: "token", refresh_token: "refresh" }));

    let rateLimited = false;
    for (let index = 0; index < 80; index++) {
      const response = await worker.fetch(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "rate-limit-user@example.com", password: "secret-123" })
        }),
        env
      );
      if (response.status === 429) {
        expect(response.headers.get("retry-after")).toBeTruthy();
        rateLimited = true;
        break;
      }
    }
    expect(rateLimited).toBe(true);
  });

  it("fails closed for auth login when rate limiter store is unavailable", async () => {
    const env = createMockEnv({
      RATE_LIMITER_DO: undefined,
      SUPABASE_URL: TEST_SUPABASE_URL,
      SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await worker.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com", password: "password123" })
      }),
      env
    );
    const payload = await responseJson(response);

    expect(response.status).toBe(503);
    expect(payload.ok).toBe(false);
    expect(payload.error.message).toMatch(/Rate limiter is not configured/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("opens auth circuit after repeated upstream failures and fast-fails subsequent requests", async () => {
    const env = createMockEnv({
      SUPABASE_URL: TEST_SUPABASE_URL,
      SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(503, { error: "service unavailable" }));

    const request = () =>
      worker.fetch(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "breaker@example.com", password: "password123" })
        }),
        env
      );

    for (let index = 0; index < 3; index++) {
      const response = await request();
      const payload = await responseJson(response);
      expect(response.status).toBe(502);
      expect(payload.ok).toBe(false);
    }

    const blockedResponse = await request();
    const blockedPayload = await responseJson(blockedResponse);
    expect(blockedResponse.status).toBe(503);
    expect(blockedPayload.ok).toBe(false);
    expect(blockedPayload.error.message).toMatch(/temporarily unavailable/);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("opens auth circuit, waits for cooldown, then resumes with one half-open probe", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    vi.setSystemTime(start);

    try {
      const env = createMockEnv({
        SUPABASE_URL: TEST_SUPABASE_URL,
        SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY
      });
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(jsonResponse(503, { error: "service unavailable" }))
        .mockResolvedValueOnce(jsonResponse(503, { error: "service unavailable" }))
        .mockResolvedValueOnce(jsonResponse(503, { error: "service unavailable" }))
        .mockResolvedValueOnce(jsonResponse(200, { access_token: "session-access", refresh_token: "session-refresh" }))
        .mockResolvedValue(jsonResponse(200, { access_token: "session-access", refresh_token: "session-refresh" }));

      const request = () =>
        worker.fetch(
          new Request("http://localhost/api/auth/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: "breaker2@example.com", password: "password123" })
          }),
          env
        );

      for (let index = 0; index < 3; index++) {
        const response = await request();
        const payload = await responseJson(response);
        expect(response.status).toBe(502);
        expect(payload.ok).toBe(false);
      }

      const blockedAfterFailure = await request();
      const blockedPayload = await responseJson(blockedAfterFailure);
      expect(blockedAfterFailure.status).toBe(503);
      expect(blockedPayload.ok).toBe(false);
      expect(blockedPayload.error.message).toMatch(/temporarily unavailable/);
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      vi.advanceTimersByTime(8_001);
      const firstProbe = await request();
      expect(firstProbe.status).toBe(200);
      const firstPayload = await responseJson(firstProbe);
      expect(firstPayload.ok).toBe(true);
      expect(firstPayload.data.access_token).toBe("session-access");
      expect(fetchSpy).toHaveBeenCalledTimes(4);

      const secondAttempt = await request();
      expect(secondAttempt.status).toBe(200);
      const secondPayload = await responseJson(secondAttempt);
      expect(secondPayload.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns feed with license payload", async () => {
    const response = await worker.fetch(new Request("http://localhost/api/feed?tab=breaking"), createMockEnv());
    expect(response.status).toBe(200);
    const payload = await responseJson(response);
    expect(payload.ok).toBe(true);
    expect(payload.data.items[0].license).toBeDefined();
  });

  it("supports feed search by entity ticker", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/api/feed?tab=breaking&query=nvda"),
      createMockEnv()
    );
    expect(response.status).toBe(200);
    const payload = await responseJson(response);
    expect(payload.ok).toBe(true);
    expect(payload.data.items.length).toBeGreaterThan(0);
    const hasNvidiaEntity = payload.data.items.some((item: any) =>
      (item.entities ?? []).some(
        (entity: any) => entity?.name?.toLowerCase?.().includes("nvidia") || entity?.primary_ticker === "NVDA"
      )
    );
    expect(hasNvidiaEntity).toBe(true);
  });

  it("blocks conditional-license series from public series endpoint", async () => {
    const env = createMockEnv();
    const store = MemoryStore.get();
    const blockedSeriesId = `blocked-series-${Date.now()}`;

    store.series.push({
      series_id: blockedSeriesId,
      title: "Blocked Conditional Series",
      source: {
        name: "OECD",
        policy_url: "https://www.oecd.org/en/about/terms-conditions.html"
      },
      license: {
        code: "OECD_CONDITIONAL",
        commercial_status: "conditional",
        attribution_text: "Source: OECD (license review required)."
      },
      units: "%",
      is_derived: false,
      raw_locked: false,
      observations: [{ obs_date: "2026-01-01", value_raw: "6.1", value_num: 6.1 }]
    });

    try {
      const response = await worker.fetch(
        new Request(`http://localhost/api/series/${encodeURIComponent(blockedSeriesId)}?mode=raw`),
        env
      );
      const payload = await responseJson(response);

      expect(response.status).toBe(404);
      expect(payload.ok).toBe(false);
      expect(payload.error.message).toMatch(/Series not found/);
    } finally {
      const index = store.series.findIndex((entry) => entry.series_id === blockedSeriesId);
      if (index >= 0) {
        store.series.splice(index, 1);
      }
    }
  });

  it("filters conditional-license items from public entity endpoint", async () => {
    const env = createMockEnv();
    const store = MemoryStore.get();
    const blockedItemId = `itm-blocked-${Date.now()}`;

    store.contentItems.push({
      item_id: blockedItemId,
      item_type: "analysis",
      event_time: new Date().toISOString(),
      headline_generated: "OECD labor dataset queued for policy clearance",
      summary_generated: "Conditional-license dataset pending review.",
      external_url: "https://www.oecd.org/",
      source_name: "OECD",
      source_policy_url: "https://www.oecd.org/en/about/terms-conditions.html",
      license_code: "OECD_CONDITIONAL",
      commercial_status: "conditional",
      attribution_text: "Source: OECD (license review required).",
      disclaimer_text: "Blocked from production unless cleared.",
      entity_slugs: ["nvidia"],
      is_breaking: false,
      region: "GLOBAL",
      meta: { status: "quarantine" }
    });

    try {
      const response = await worker.fetch(new Request("http://localhost/api/entity/nvidia"), env);
      const payload = await responseJson(response);

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.data.items.some((item: any) => item.item_id === blockedItemId)).toBe(false);
      expect(payload.data.items.every((item: any) => item.license?.commercial_status === "allowed")).toBe(true);
    } finally {
      const index = store.contentItems.findIndex((entry) => entry.item_id === blockedItemId);
      if (index >= 0) {
        store.contentItems.splice(index, 1);
      }
    }
  });

  it("rejects protected routes without token", async () => {
    const response = await worker.fetch(new Request("http://localhost/api/alerts/rules"), createMockEnv());
    expect(response.status).toBe(401);
  });

  it("rejects stream requests without token", async () => {
    const response = await worker.fetch(new Request("http://localhost/api/stream?tab=breaking"), createMockEnv());
    expect(response.status).toBe(401);
  });

  it("fails closed for stream when rate limiter store is unavailable", async () => {
    const env = createMockEnv({ RATE_LIMITER_DO: undefined });
    const response = await worker.fetch(
      new Request("http://localhost/api/stream?tab=breaking", {
        headers: { authorization: "Bearer test-user:user-a" }
      }),
      env
    );
    expect(response.status).toBe(503);
  });

  it("rate-limits stream connections after quota is exhausted", async () => {
    const env = createMockEnv();
    const streamRateKey = rateLimitKey("stream", "user-a:203.0.113.10", "connect");
    const streamRateConfig = { limit: 20, windowMs: 60 * 1000 };
    for (let index = 0; index < streamRateConfig.limit; index += 1) {
      const permit = await checkRateLimit(env.OFP_KV!, streamRateKey, streamRateConfig, Date.now(), env.RATE_LIMITER_DO);
      expect(permit.allowed).toBe(true);
    }

    const response = await worker.fetch(
      new Request("http://localhost/api/stream?tab=breaking", {
        headers: {
          authorization: "Bearer test-user:user-a",
          "x-forwarded-for": "203.0.113.10"
        }
      }),
      env
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
  });

  it("fails closed for alert rules when rate limiter store is unavailable", async () => {
    const env = createMockEnv({ RATE_LIMITER_DO: undefined });
    const requestHeaders = {
      "content-type": "application/json",
      authorization: "Bearer test-user:user-a"
    };

    const getResponse = await worker.fetch(
      new Request("http://localhost/api/alerts/rules", {
        headers: { authorization: requestHeaders.authorization }
      }),
      env
    );
    expect(getResponse.status).toBe(503);

    const postResponse = await worker.fetch(
      new Request("http://localhost/api/alerts/rules", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          enabled: true,
          rule_type: "breaking",
          rule: { tab: "breaking" }
        })
      }),
      env
    );
    expect(postResponse.status).toBe(503);
  });

  it("allows reading own alert rules when test token is provided", async () => {
    const env = createMockEnv();
    const createResponse = await worker.fetch(
      new Request("http://localhost/api/alerts/rules", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-user:user-a"
        },
        body: JSON.stringify({
          enabled: true,
          rule_type: "breaking",
          rule: { tab: "breaking" }
        })
      }),
      env
    );
    expect(createResponse.status).toBe(200);

    const readResponse = await worker.fetch(
      new Request("http://localhost/api/alerts/rules", {
        headers: { authorization: "Bearer test-user:user-a" }
      }),
      env
    );
    const readPayload = await responseJson(readResponse);
    expect(readPayload.data.rules.length).toBeGreaterThan(0);
  });

  it("normalizes cached gdelt links before response", async () => {
    const env = createMockEnv();
    const cacheKey = "feed:breaking::GLOBAL:0";
    const cachedPayload = {
      items: [
        {
          item_id: "gdelt-cache-hit",
          item_type: "gdelt_link",
          event_time: new Date().toISOString(),
          headline: "SEC mentions spike",
          summary: null,
          external_url: "https://api.gdeltproject.org/api/v2/doc/doc?query=SEC&mode=artlist&format=html&sort=datedesc&maxrecords=20",
          source: { name: "GDELT", policy_url: "" },
          license: {
            code: "GDELT",
            commercial_status: "allowed",
            attribution_text: "Index data: GDELT (citation + link).",
            disclaimer_text: "Publisher content is not hosted on this site."
          },
          entities: []
        }
      ],
      next_cursor: null
    };

    await env.OFP_KV.put(cacheKey, JSON.stringify(cachedPayload));

    const response = await worker.fetch(new Request("http://localhost/api/feed?tab=breaking"), env);
    expect(response.status).toBe(200);
    const payload = await responseJson(response);

    expect(payload.data.items[0].external_url).toBe(
      "https://api.gdeltproject.org/api/v2/doc/doc?query=SEC&mode=artlist&format=html&sort=datedesc&maxrecords=5"
    );
  });

  it("processes push queue fanout message through worker queue handler", async () => {
    const env = createMockEnv();
    const store = MemoryStore.get();
    store.pushSubscriptions.length = 0;
    store.alertRules.length = 0;
    store.notificationEvents.length = 0;

    store.upsertPushSubscription({
      user_id: "queue-user",
      endpoint_hash: "queue-endpoint",
      endpoint_enc: "enc",
      p256dh_enc: "p256",
      auth_enc: "auth",
      enc_iv: "iv",
      filters: {}
    });
    store.saveAlertRule("queue-user", {
      enabled: true,
      rule_type: "breaking",
      rule: { tab: "breaking" }
    });

    const message: PushQueueMessage = {
      job: "PUSH_FANOUT_BREAKING",
      run_id: "run-queue-push",
      params: { limit: 5 }
    };

    const batch = {
      messages: [
        {
          body: message,
          ack() {
            return;
          },
          retry() {
            return;
          }
        }
      ]
    };

    await worker.queue(batch as any, env);

    const events = store.listNotificationEvents("queue-user");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].status).toBe("sent");
  });

  it("supports account audit write and read flow", async () => {
    const env = createMockEnv();

    const postResponse = await worker.fetch(
      new Request("http://localhost/api/account/audit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-user:user-a"
        },
        body: JSON.stringify({
          action: "login",
          outcome: "success",
          details: "unit-test login success"
        })
      }),
      env
    );

    expect(postResponse.status).toBe(200);
    const postPayload = await responseJson(postResponse);
    expect(postPayload.ok).toBe(true);
    expect(postPayload.data.count).toBe(1);

    const getResponse = await worker.fetch(
      new Request("http://localhost/api/account/audit", {
        headers: { authorization: "Bearer test-user:user-a" }
      }),
      env
    );

    expect(getResponse.status).toBe(200);
    const getPayload = await responseJson(getResponse);
    expect(getPayload.ok).toBe(true);
    expect(Array.isArray(getPayload.data.events)).toBe(true);
    expect(getPayload.data.events[0].action).toBe("login");
    expect(getPayload.data.events[0].outcome).toBe("success");
    expect(getPayload.data.events[0].details).toBe("unit-test login success");
    expect(getPayload.data.events[0].source).toBe("server");
  });

  it("rejects invalid account audit payloads", async () => {
    const env = createMockEnv();
    const postResponse = await worker.fetch(
      new Request("http://localhost/api/account/audit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-user:user-a"
        },
        body: JSON.stringify({ action: "unsupported", outcome: "success" })
      }),
      env
    );
    expect(postResponse.status).toBe(400);
  });

  it("rate-limits account audit writes", async () => {
    const env = createMockEnv();
    let rateLimited = false;

    for (let index = 0; index < 80; index++) {
      const response = await worker.fetch(
        new Request("http://localhost/api/account/audit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer test-user:user-a"
          },
          body: JSON.stringify({
            action: "token_view",
            outcome: "success",
            details: `attack-attempt-${index}`
          })
        }),
        env
      );
      if (response.status === 429) {
        expect(response.headers.get("retry-after")).toBeTruthy();
        rateLimited = true;
        break;
      }
    }

    expect(rateLimited).toBe(true);
  });

  it("rate-limits alert rule writes", async () => {
    const env = createMockEnv();
    let rateLimited = false;
    const body = JSON.stringify({
      enabled: true,
      rule_type: "breaking",
      rule: { tab: "breaking" }
    });

    for (let index = 0; index < 80; index++) {
      const response = await worker.fetch(
        new Request("http://localhost/api/alerts/rules", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer test-user:user-a"
          },
          body
        }),
        env
      );
      if (response.status === 429) {
        expect(response.headers.get("retry-after")).toBeTruthy();
        rateLimited = true;
        break;
      }
    }

    expect(rateLimited).toBe(true);
  });

  it("rejects oversized alert rule payloads", async () => {
    const env = createMockEnv();
    const response = await worker.fetch(
      new Request("http://localhost/api/alerts/rules", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-user:user-a"
        },
        body: JSON.stringify({
          enabled: true,
          rule_type: "breaking",
          rule: { blob: "x".repeat(12_000) }
        })
      }),
      env
    );
    const payload = await responseJson(response);

    expect(response.status).toBe(413);
    expect(payload.ok).toBe(false);
    expect(payload.error.message).toMatch(/payload is too large/i);
  });

  it("rejects oversized push subscription payloads", async () => {
    const env = createMockEnv();
    const response = await worker.fetch(
      new Request("http://localhost/api/push/subscribe", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-user:user-a"
        },
        body: JSON.stringify({
          endpoint: "https://push.example.dev/subscription",
          keys: {
            p256dh: "p256dh-value",
            auth: "auth-value"
          },
          filters: {
            blob: "x".repeat(20_000)
          }
        })
      }),
      env
    );
    const payload = await responseJson(response);

    expect(response.status).toBe(413);
    expect(payload.ok).toBe(false);
    expect(payload.error.message).toMatch(/payload is too large/i);
  });
});
