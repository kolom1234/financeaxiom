import type { FeedItemPayload } from "@ofp/shared";
import { decryptField } from "../services/crypto";
import { hasDatabase } from "../services/db";
import { describeError, logEvent } from "../services/log";
import {
  listPushTargets,
  queryFeed,
  registerNotificationEvent,
  removePushSubscriptionById,
  setNotificationStatus,
  type PushTarget
} from "../services/postgres";
import { MemoryStore } from "../services/store";
import type { AlertRuleRecord, Env, NotificationEventRecord, PushQueueMessage, PushSubscriptionRecord } from "../types";
import { sendWebPush, vapidConfigFrom, type PushDeliveryResult, type VapidConfig } from "./webpush";

const DEFAULT_BREAKING_SCAN_LIMIT = 25;
const MAX_BREAKING_SCAN_LIMIT = 100;
/** SPEC M7: at most 10 notifications per user per rolling hour. */
export const NOTIFICATIONS_PER_USER_PER_HOUR = 10;

export function isPushMessage(input: unknown): input is PushQueueMessage {
  return Boolean(input) && typeof input === "object" && (input as { job?: unknown }).job === "PUSH_FANOUT_BREAKING";
}

function ruleValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function matchesRule(rule: AlertRuleRecord, item: FeedItemPayload): boolean {
  switch (rule.rule_type) {
    case "breaking":
      return true;
    case "macro":
      return item.item_type === "macro_update";
    case "entity": {
      const target = ruleValue(rule.rule.slug ?? rule.rule.entity).toLowerCase();
      return target.length > 0 && item.entities.some((entity) => entity.slug.toLowerCase() === target);
    }
    case "ticker": {
      const target = ruleValue(rule.rule.ticker ?? rule.rule.symbol).toUpperCase();
      return target.length > 0 && item.entities.some((entity) => (entity.primary_ticker ?? "").toUpperCase() === target);
    }
    case "filing_form": {
      if (item.item_type !== "sec_filing" && item.item_type !== "fact_flash") {
        return false;
      }
      const target = ruleValue(rule.rule.form_type ?? rule.rule.form).toUpperCase();
      if (!target) {
        return true;
      }
      // Exact form match (8-K must not match 8-K/A or 18-K).
      const formType = ruleValue(item.meta?.form_type).toUpperCase();
      return formType === target;
    }
    default:
      return false;
  }
}

function toNotificationPayload(item: FeedItemPayload): Record<string, unknown> {
  return {
    title: item.headline.slice(0, 200),
    body: (item.summary ?? "Open the official source for details.").slice(0, 400),
    link: item.external_url ?? "",
    item_id: item.item_id,
    item_type: item.item_type,
    source: item.source.name,
    attribution_footer: item.license.attribution_text
  };
}

function clampLimit(value: unknown): number {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    return DEFAULT_BREAKING_SCAN_LIMIT;
  }
  return Math.min(Math.floor(asNumber), MAX_BREAKING_SCAN_LIMIT);
}

/** Abstraction over the persistent store and the test-only memory store. */
interface PushStore {
  breakingItems(limit: number): Promise<FeedItemPayload[]>;
  targets(): Promise<PushTarget[]>;
  register(userId: string, itemId: string, payload: Record<string, unknown>): Promise<NotificationEventRecord | null>;
  setStatus(notificationId: string, status: NotificationEventRecord["status"], error: string | null): Promise<void>;
  removeSubscription(subscriptionId: string): Promise<void>;
}

function databaseStore(env: Env): PushStore {
  return {
    breakingItems: async (limit) => (await queryFeed(env, { tab: "breaking", query: "", region: "GLOBAL", limit, cursor: null })).items,
    targets: () => listPushTargets(env),
    register: (userId, itemId, payload) =>
      registerNotificationEvent(env, { userId, itemId, payload, hourlyCap: NOTIFICATIONS_PER_USER_PER_HOUR }),
    setStatus: (id, status, error) => setNotificationStatus(env, id, status, error),
    removeSubscription: (id) => removePushSubscriptionById(env, id)
  };
}

function memoryStore(): PushStore {
  const store = MemoryStore.get();
  return {
    breakingItems: async (limit) => store.listFeed("breaking").slice(0, limit),
    targets: async () =>
      store
        .listPushUserIds()
        .map((userId) => ({
          userId,
          rules: store.listAlertRules(userId).filter((rule) => rule.enabled),
          subscriptions: store.listPushSubscriptions(userId)
        }))
        .filter((target) => target.rules.length > 0 && target.subscriptions.length > 0),
    register: async (userId, itemId, payload) => store.registerNotificationEvent(userId, itemId, payload),
    setStatus: async (id, status) => store.setNotificationStatus(id, status),
    removeSubscription: async (id) => store.removePushSubscriptionById(id)
  };
}

async function decryptSubscription(
  subscription: PushSubscriptionRecord,
  key: string
): Promise<{ endpoint: string; p256dh: string; auth: string }> {
  return {
    endpoint: await decryptField(subscription.endpoint_enc, subscription.endpoint_iv, key),
    p256dh: await decryptField(subscription.p256dh_enc, subscription.p256dh_iv, key),
    auth: await decryptField(subscription.auth_enc, subscription.auth_iv, key)
  };
}

async function writeAudit(env: Env, key: string, payload: Record<string, unknown>): Promise<void> {
  if (!env.AUDIT_R2) {
    return;
  }
  try {
    await env.AUDIT_R2.put(key, JSON.stringify(payload, null, 2), { httpMetadata: { contentType: "application/json" } });
  } catch (error) {
    logEvent("warn", "push_audit_write_failed", describeError(error));
  }
}

export interface PushFanoutSummary {
  status: "completed" | "not_configured";
  notifications: number;
  delivered: number;
  failed: number;
  skipped: number;
  removed_subscriptions: number;
}

export async function handlePushJob(
  message: PushQueueMessage,
  env: Env,
  deps: { send?: (sub: { endpoint: string; p256dh: string; auth: string }, payload: Record<string, unknown>, vapid: VapidConfig) => Promise<PushDeliveryResult> } = {}
): Promise<PushFanoutSummary> {
  const summary: PushFanoutSummary = { status: "completed", notifications: 0, delivered: 0, failed: 0, skipped: 0, removed_subscriptions: 0 };
  const vapid = vapidConfigFrom(env);
  if (!vapid || !env.PUSH_DATA_ENC_KEY) {
    // Never record notifications as "sent" when nothing can be delivered.
    logEvent("warn", "push_not_configured", { run_id: message.run_id, vapid: Boolean(vapid), enc_key: Boolean(env.PUSH_DATA_ENC_KEY) });
    return { ...summary, status: "not_configured" };
  }

  let store: PushStore;
  if (hasDatabase(env)) {
    store = databaseStore(env);
  } else if (env.TEST_AUTH_BYPASS === "1") {
    store = memoryStore();
  } else {
    throw new Error("Persistent push store is unavailable.");
  }
  const send = deps.send ?? ((sub, payload, config) => sendWebPush(sub, payload, config));

  const items = await store.breakingItems(clampLimit(message.params.limit));
  if (items.length === 0) {
    return summary;
  }

  for (const target of await store.targets()) {
    const subscriptions: Array<{ record: PushSubscriptionRecord; decrypted: { endpoint: string; p256dh: string; auth: string } }> = [];
    for (const record of target.subscriptions) {
      try {
        subscriptions.push({ record, decrypted: await decryptSubscription(record, env.PUSH_DATA_ENC_KEY) });
      } catch (error) {
        logEvent("warn", "push_subscription_undecryptable", { subscription_id: record.subscription_id, ...describeError(error) });
      }
    }
    if (subscriptions.length === 0) {
      continue;
    }

    for (const item of items) {
      if (!target.rules.some((rule) => matchesRule(rule, item))) {
        continue;
      }
      const payload = toNotificationPayload(item);
      const event = await store.register(target.userId, item.item_id, payload);
      if (!event) {
        summary.skipped += 1; // duplicate or hourly cap reached
        continue;
      }
      summary.notifications += 1;

      let deliveredTo = 0;
      const errors: string[] = [];
      for (const { record, decrypted } of subscriptions) {
        try {
          const result = await send(decrypted, payload, vapid);
          if (result.outcome === "delivered") {
            deliveredTo += 1;
          } else if (result.outcome === "gone") {
            await store.removeSubscription(record.subscription_id);
            summary.removed_subscriptions += 1;
            errors.push(`gone:${result.status}`);
          } else {
            errors.push(`http:${result.status}`);
          }
        } catch (error) {
          errors.push(String((error as Error)?.message ?? error).slice(0, 80));
        }
      }

      const status: NotificationEventRecord["status"] = deliveredTo > 0 ? "sent" : "failed";
      await store.setStatus(event.notification_id, status, deliveredTo > 0 ? null : errors.join("; ").slice(0, 500));
      if (status === "sent") {
        summary.delivered += 1;
      } else {
        summary.failed += 1;
      }
      await writeAudit(env, `push/${event.notification_id}.json`, {
        run_id: message.run_id,
        notification_id: event.notification_id,
        item_id: item.item_id,
        status,
        delivered_to: deliveredTo,
        errors
      });
    }
  }

  logEvent("info", "push_fanout_completed", { run_id: message.run_id, ...summary });
  return summary;
}
