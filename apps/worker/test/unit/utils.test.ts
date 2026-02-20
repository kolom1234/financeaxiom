import { describe, expect, it } from "vitest";
import { corsHeaders, errorJson } from "../../src/routes/utils";
import type { Env } from "../../src/types";

function createRequest(origin?: string): Request {
  return new Request("https://api.financeaxiom.com/api/feed", {
    headers: {
      ...(origin ? { origin } : {})
    }
  });
}

describe("cors headers", () => {
  const env: Env = {
    ALLOWED_ORIGINS: "https://financeaxiom.com,https://www.financeaxiom.com, https://api.financeaxiom.com"
  } as Env;

  it("allows configured origins with case/space normalization", () => {
    const request = createRequest("https://WWW.FINANCEAXIOM.COM");
    const headers = corsHeaders(request, env);
    expect(headers.get("access-control-allow-origin")).toBe("https://www.financeaxiom.com");
    expect(headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("blocks unconfigured origins", () => {
    const request = createRequest("https://evil.example.com");
    const headers = corsHeaders(request, env);
    expect(headers.get("access-control-allow-origin")).toBe("null");
  });

  it("does not break error payload structure when using invalid origin", async () => {
    const response = errorJson(createRequest("https://evil.example.com"), env, 403, "forbidden");
    const payload = (await response.json()) as { ok: boolean; error: { message: string } };
    expect(response.status).toBe(403);
    expect(payload.ok).toBe(false);
    expect(payload.error.message).toBe("forbidden");
  });
});
