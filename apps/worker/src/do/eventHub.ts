import type { Env } from "../types";

interface HubEvent {
  item_id: string;
  event_time: string;
  tab: "breaking" | "macro" | "filings";
}

const EVENT_HUB_AUTH_HEADER = "x-ofp-eventhub-token";
const MAX_EVENTS_PER_TAB = 20;

function isHubTab(value: unknown): value is HubEvent["tab"] {
  return value === "breaking" || value === "macro" || value === "filings";
}

function isIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function isHubEventPayload(value: unknown): value is HubEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.item_id !== "string" || payload.item_id.trim().length === 0 || payload.item_id.length > 256) {
    return false;
  }
  if (typeof payload.event_time !== "string" || !isIsoTimestamp(payload.event_time)) {
    return false;
  }
  if (!isHubTab(payload.tab)) {
    return false;
  }
  return true;
}

function badRequest(message: string): Response {
  return Response.json(
    { ok: false, error: { message } },
    {
      status: 400
    }
  );
}

export class EventHubDO {
  private latestByTab = new Map<HubEvent["tab"], HubEvent[]>();

  constructor(
    private readonly _state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const configuredToken = this.env.EVENT_HUB_INTERNAL_TOKEN?.trim();
    const headerToken = request.headers.get(EVENT_HUB_AUTH_HEADER)?.trim();

    if (!configuredToken || headerToken !== configuredToken) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (request.method === "POST" && url.pathname === "/publish") {
      let payloadRaw: unknown;
      try {
        payloadRaw = await request.json();
      } catch {
        return badRequest("Invalid JSON body.");
      }
      if (!isHubEventPayload(payloadRaw)) {
        return badRequest("Invalid event payload.");
      }
      const payload = payloadRaw;
      const current = this.latestByTab.get(payload.tab) ?? [];
      current.unshift(payload);
      this.latestByTab.set(payload.tab, current.slice(0, MAX_EVENTS_PER_TAB));
      return Response.json({ ok: true });
    }

    if (request.method === "GET" && url.pathname === "/latest") {
      const tabParam = url.searchParams.get("tab") ?? "breaking";
      if (!isHubTab(tabParam)) {
        return badRequest("Invalid tab.");
      }
      const tab = tabParam;
      return Response.json({ ok: true, data: this.latestByTab.get(tab) ?? [] });
    }

    return new Response("Not found", { status: 404 });
  }
}
