import { SlidingWindowPerSecondLimiter } from "../services/rateLimiter";

export class SecLimiterDO {
  private readonly limiter = new SlidingWindowPerSecondLimiter(10);

  constructor(private readonly _state: DurableObjectState) {}

  async fetch(_request: Request): Promise<Response> {
    const granted = this.limiter.acquire(Date.now());
    if (!granted) {
      return Response.json({ ok: false, reason: "rate_limited" }, { status: 429 });
    }
    return Response.json({ ok: true }, { status: 200 });
  }
}

