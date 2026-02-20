import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/services/store";
import type { InternalContentItem } from "../../src/types";

function resetStoreState(): void {
  const store = MemoryStore.get();
  store.pushSubscriptions.length = 0;
  store.alertRules.length = 0;
  store.notificationEvents.length = 0;
}

describe("memory store safeguards", () => {
  it("caps fallback in-memory collections to bounded sizes", () => {
    resetStoreState();
    const store = MemoryStore.get();

    for (let index = 0; index < 2500; index += 1) {
      store.upsertPushSubscription({
        user_id: `user-${index}`,
        endpoint_hash: `endpoint-${index}`,
        endpoint_enc: "enc",
        p256dh_enc: "p256",
        auth_enc: "auth",
        enc_iv: "iv",
        filters: {}
      });
      store.saveAlertRule(`user-${index}`, {
        enabled: true,
        rule_type: "breaking",
        rule: { tab: "breaking", index }
      });
    }

    for (let index = 0; index < 6000; index += 1) {
      store.registerNotificationEvent(`notif-user-${index}`, `item-${index}`, { index });
    }

    expect(store.pushSubscriptions.length).toBeLessThanOrEqual(2000);
    expect(store.alertRules.length).toBeLessThanOrEqual(2000);
    expect(store.notificationEvents.length).toBeLessThanOrEqual(5000);
  });

  it("caps content items when fallback ingest appends continuously", () => {
    const store = MemoryStore.get();
    for (let index = 0; index < 700; index += 1) {
      const item: InternalContentItem = {
        item_id: `content-cap-${index}`,
        item_type: "gdelt_link",
        event_time: new Date(Date.now() + index * 1000).toISOString(),
        headline_generated: `Synthetic headline ${index}`,
        summary_generated: "Synthetic summary",
        external_url: "https://api.gdeltproject.org/api/v2/doc/doc?query=synthetic&mode=artlist&format=html&sort=datedesc&maxrecords=5",
        source_name: "GDELT",
        source_policy_url: "https://www.gdeltproject.org/about.html",
        license_code: "GDELT",
        commercial_status: "allowed",
        attribution_text: "Index data: GDELT (citation + link).",
        disclaimer_text: "Publisher content is not hosted on this site.",
        entity_slugs: [],
        is_breaking: true,
        region: "GLOBAL",
        meta: { index }
      };
      store.appendContentItem(item);
    }

    expect(store.contentItems.length).toBeLessThanOrEqual(500);
  });
});
