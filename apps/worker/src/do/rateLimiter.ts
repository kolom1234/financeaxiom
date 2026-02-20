interface RateLimiterRequestBody {
  limit?: unknown;
  windowMs?: unknown;
  nowMs?: unknown;
}

interface WindowState {
  windowStart: number;
  count: number;
}

function computeWindowStart(nowMs: number, windowMs: number): number {
  return nowMs - (nowMs % windowMs);
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const floored = Math.floor(value);
  if (floored <= 0) {
    return null;
  }
  return floored;
}

function badRequest(message: string): Response {
  return Response.json(
    { ok: false, error: { message } },
    {
      status: 400
    }
  );
}

export class RateLimiterDO {
  private state: WindowState | null = null;

  constructor(private readonly _state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/check") {
      return new Response("Not found", { status: 404 });
    }

    let rawBody: RateLimiterRequestBody;
    try {
      rawBody = (await request.json()) as RateLimiterRequestBody;
    } catch {
      return badRequest("Invalid JSON body.");
    }

    const limit = normalizePositiveInteger(rawBody.limit);
    if (!limit) {
      return badRequest("limit must be a positive integer.");
    }
    const windowMs = normalizePositiveInteger(rawBody.windowMs);
    if (!windowMs) {
      return badRequest("windowMs must be a positive integer.");
    }

    const nowCandidate = typeof rawBody.nowMs === "number" && Number.isFinite(rawBody.nowMs) ? rawBody.nowMs : Date.now();
    const nowMs = Math.max(0, Math.floor(nowCandidate));
    const windowStart = computeWindowStart(nowMs, windowMs);

    if (!this.state || this.state.windowStart !== windowStart) {
      this.state = {
        windowStart,
        count: 1
      };
    } else {
      this.state.count += 1;
    }

    const allowed = this.state.count <= limit;
    const remaining = Math.max(0, limit - this.state.count);
    const retryAfterMs = allowed ? 0 : Math.max(0, windowStart + windowMs - nowMs);

    return Response.json({
      allowed,
      limit,
      remaining,
      windowMs,
      windowStart,
      retryAfterMs
    });
  }
}

