import { describe, expect, it } from "vitest";
import { EventHubDO } from "../../src/do/eventHub";
import type { Env } from "../../src/types";

const INTERNAL_TOKEN = "event-hub-internal-token";

function createHub(overrides: Partial<Env> = {}): EventHubDO {
  return new EventHubDO(
    {} as DurableObjectState,
    {
      EVENT_HUB_INTERNAL_TOKEN: INTERNAL_TOKEN,
      ...overrides
    } as Env
  );
}

describe("EventHubDO security", () => {
  it("rejects requests when internal token is missing or invalid", async () => {
    const hub = createHub();

    const missingHeader = await hub.fetch(new Request("https://internal/latest?tab=breaking"));
    expect(missingHeader.status).toBe(401);

    const wrongHeader = await hub.fetch(
      new Request("https://internal/latest?tab=breaking", {
        headers: { "x-ofp-eventhub-token": "wrong-token" }
      })
    );
    expect(wrongHeader.status).toBe(401);
  });

  it("rejects malformed publish payloads", async () => {
    const hub = createHub();
    const response = await hub.fetch(
      new Request("https://internal/publish", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ofp-eventhub-token": INTERNAL_TOKEN
        },
        body: JSON.stringify({
          tab: "breaking",
          item_id: "",
          event_time: "not-a-date"
        })
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.ok).toBe(false);
  });

  it("accepts authorized publish and returns bounded latest list", async () => {
    const hub = createHub();
    const headers = {
      "content-type": "application/json",
      "x-ofp-eventhub-token": INTERNAL_TOKEN
    };

    for (let index = 0; index < 25; index += 1) {
      const publish = await hub.fetch(
        new Request("https://internal/publish", {
          method: "POST",
          headers,
          body: JSON.stringify({
            item_id: `item-${index}`,
            event_time: new Date(Date.now() + index * 1000).toISOString(),
            tab: "breaking"
          })
        })
      );
      expect(publish.status).toBe(200);
    }

    const latest = await hub.fetch(
      new Request("https://internal/latest?tab=breaking", {
        headers: { "x-ofp-eventhub-token": INTERNAL_TOKEN }
      })
    );
    expect(latest.status).toBe(200);
    const payload = await latest.json();
    expect(payload.ok).toBe(true);
    expect(payload.data.length).toBe(20);
    expect(payload.data[0].item_id).toBe("item-24");
  });
});
