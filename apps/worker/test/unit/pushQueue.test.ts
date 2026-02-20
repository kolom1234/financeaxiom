import { describe, expect, it } from "vitest";
import { handlePushJob } from "../../src/push/queue";
import { MemoryStore } from "../../src/services/store";
import { createMockEnv } from "../helpers/mockEnv";
import type { PushQueueMessage } from "../../src/types";

function resetPushState(): void {
  const store = MemoryStore.get();
  store.pushSubscriptions.length = 0;
  store.alertRules.length = 0;
  store.notificationEvents.length = 0;
}

describe("push queue fanout", () => {
  it("dispatches once per user/item and includes attribution footer", async () => {
    resetPushState();
    const store = MemoryStore.get();

    store.upsertPushSubscription({
      user_id: "user-a",
      endpoint_hash: "endpoint-a",
      endpoint_enc: "enc",
      p256dh_enc: "p256",
      auth_enc: "auth",
      enc_iv: "iv",
      filters: {}
    });
    store.saveAlertRule("user-a", {
      enabled: true,
      rule_type: "breaking",
      rule: { tab: "breaking" }
    });

    const message: PushQueueMessage = {
      job: "PUSH_FANOUT_BREAKING",
      run_id: "run-push-1",
      params: { limit: 10 }
    };

    const env = createMockEnv();
    await handlePushJob(message, env);
    await handlePushJob(message, env);

    const events = store.listNotificationEvents("user-a");
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.status).toBe("sent");
      expect(event.payload.attribution_footer).toBeTypeOf("string");
      expect((event.payload.attribution_footer as string).length).toBeGreaterThan(0);
    }

    const itemIds = new Set(events.map((event) => event.item_id));
    expect(itemIds.size).toBe(events.length);
  });

  it("enforces per-user 10-per-hour notification cap", async () => {
    resetPushState();
    const store = MemoryStore.get();

    store.upsertPushSubscription({
      user_id: "user-b",
      endpoint_hash: "endpoint-b",
      endpoint_enc: "enc",
      p256dh_enc: "p256",
      auth_enc: "auth",
      enc_iv: "iv",
      filters: {}
    });
    store.saveAlertRule("user-b", {
      enabled: true,
      rule_type: "breaking",
      rule: { tab: "breaking" }
    });

    const baseTime = Date.now();
    for (let index = 0; index < 15; index += 1) {
      store.appendContentItem({
        item_id: `itm-limit-${index}`,
        item_type: "gdelt_link",
        event_time: new Date(baseTime + index * 1000).toISOString(),
        headline_generated: `Synthetic breaking ${index}`,
        summary_generated: "Detected via index metadata.",
        external_url: "https://api.gdeltproject.org/api/v2/doc/doc?query=gdelt&mode=artlist&format=html&sort=datedesc&maxrecords=5",
        source_name: "GDELT",
        source_policy_url: "https://www.gdeltproject.org/about.html",
        license_code: "GDELT",
        commercial_status: "allowed",
        attribution_text: "Index data: GDELT (citation + link).",
        disclaimer_text: "Publisher content is not hosted on this site.",
        entity_slugs: [],
        is_breaking: true,
        region: "GLOBAL",
        meta: { test_case: "rate_limit" }
      });
    }

    const env = createMockEnv();
    await handlePushJob(
      {
        job: "PUSH_FANOUT_BREAKING",
        run_id: "run-push-2",
        params: { limit: 40 }
      },
      env
    );

    const events = store.listNotificationEvents("user-b");
    expect(events.length).toBe(10);
    expect(events.every((event) => event.status === "sent")).toBe(true);
  });

  it("fails closed when persistent stores are unavailable outside local fallback mode", async () => {
    resetPushState();
    const env = createMockEnv({
      TEST_AUTH_BYPASS: "0"
    });

    await expect(
      handlePushJob(
        {
          job: "PUSH_FANOUT_BREAKING",
          run_id: "run-push-prod",
          params: { limit: 10 }
        },
        env
      )
    ).rejects.toThrow(/Persistent feed store is unavailable/);
  });
});
