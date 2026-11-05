import { beforeEach, describe, expect, it } from "vitest";
import { handlePushJob, matchesRule } from "../../src/push/queue";
import type { PushDeliveryResult } from "../../src/push/webpush";
import { MemoryStore } from "../../src/services/store";
import { createMockEnv } from "../helpers/mockEnv";
import { resetMemoryPushState, storeMemorySubscription, vapidEnv } from "../helpers/push";
import type { AlertRuleRecord, PushQueueMessage } from "../../src/types";

const message: PushQueueMessage = { job: "PUSH_FANOUT_BREAKING", run_id: "run-push", params: { limit: 10 } };

function recordingSender(result: PushDeliveryResult = { outcome: "delivered", status: 201 }) {
  const calls: Array<{ endpoint: string; p256dh: string; auth: string; payload: Record<string, unknown> }> = [];
  return {
    calls,
    send: async (sub: { endpoint: string; p256dh: string; auth: string }, payload: Record<string, unknown>) => {
      calls.push({ ...sub, payload });
      return result;
    }
  };
}

describe("push queue fanout", () => {
  beforeEach(() => resetMemoryPushState());

  it("does nothing (and records nothing as sent) when VAPID is not configured", async () => {
    const env = createMockEnv();
    await storeMemorySubscription(env, "user-a");
    MemoryStore.get().saveAlertRule("user-a", { enabled: true, rule_type: "breaking", rule: {} });
    const sender = recordingSender();
    const summary = await handlePushJob(message, env, { send: sender.send });
    expect(summary.status).toBe("not_configured");
    expect(sender.calls).toHaveLength(0);
    expect(MemoryStore.get().listNotificationEvents("user-a")).toHaveLength(0);
  });

  it("decrypts the stored subscription, delivers once per user/item, and includes the attribution footer", async () => {
    const env = createMockEnv(await vapidEnv());
    const { endpoint } = await storeMemorySubscription(env, "user-a");
    MemoryStore.get().saveAlertRule("user-a", { enabled: true, rule_type: "breaking", rule: {} });
    const sender = recordingSender();

    await handlePushJob(message, env, { send: sender.send });
    await handlePushJob(message, env, { send: sender.send });

    const events = MemoryStore.get().listNotificationEvents("user-a");
    expect(events.length).toBeGreaterThan(0);
    expect(sender.calls).toHaveLength(events.length); // second run is fully de-duplicated
    expect(sender.calls.every((call) => call.endpoint === endpoint && call.p256dh.length > 80 && call.auth.length > 20)).toBe(true);
    for (const event of events) {
      expect(event.status).toBe("sent");
      expect(String(event.payload.attribution_footer).length).toBeGreaterThan(0);
    }
  });

  it("marks notifications failed (not sent) when delivery fails, and removes gone subscriptions", async () => {
    const env = createMockEnv(await vapidEnv());
    await storeMemorySubscription(env, "user-b");
    MemoryStore.get().saveAlertRule("user-b", { enabled: true, rule_type: "breaking", rule: {} });

    const summary = await handlePushJob(message, env, { send: recordingSender({ outcome: "gone", status: 410 }).send });
    expect(summary.failed).toBeGreaterThan(0);
    expect(summary.delivered).toBe(0);
    expect(MemoryStore.get().listNotificationEvents("user-b").every((event) => event.status === "failed")).toBe(true);
    expect(MemoryStore.get().listPushSubscriptions("user-b")).toHaveLength(0);
  });

  it("enforces the per-user 10-per-hour notification cap", async () => {
    const env = createMockEnv(await vapidEnv());
    await storeMemorySubscription(env, "user-c");
    MemoryStore.get().saveAlertRule("user-c", { enabled: true, rule_type: "breaking", rule: {} });
    const store = MemoryStore.get();
    for (let index = 0; index < 10; index += 1) {
      store.registerNotificationEvent("user-c", `prior-${index}`, {});
    }
    const sender = recordingSender();
    const summary = await handlePushJob(message, env, { send: sender.send });
    expect(sender.calls).toHaveLength(0);
    expect(summary.skipped).toBeGreaterThan(0);
  });

  it("fails closed when no persistent store exists outside local test mode", async () => {
    const env = createMockEnv({ ...(await vapidEnv()), TEST_AUTH_BYPASS: undefined });
    await expect(handlePushJob(message, env)).rejects.toThrow(/Persistent push store is unavailable/);
  });

  it("matches filing_form rules on the exact form type", () => {
    const rule = { rule_type: "filing_form", rule: { form_type: "8-K" }, enabled: true } as unknown as AlertRuleRecord;
    const base = {
      item_id: "i",
      item_type: "sec_filing" as const,
      event_time: new Date().toISOString(),
      headline: "[Filing] NVIDIA CORP 8-K/A filed",
      entities: [],
      source: { name: "SEC EDGAR", policy_url: "" },
      license: { code: "SEC_EDGAR", commercial_status: "allowed" as const, attribution_text: "Source: SEC EDGAR (official)." }
    };
    expect(matchesRule(rule, { ...base, meta: { form_type: "8-K/A" } })).toBe(false);
    expect(matchesRule(rule, { ...base, meta: { form_type: "8-K" } })).toBe(true);
  });
});
