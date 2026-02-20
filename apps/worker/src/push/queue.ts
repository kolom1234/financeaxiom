import type { FeedItemPayload } from "@ofp/shared";
import {
  fetchFeedFromDb,
  listAlertRulesFromDb,
  listPushSubscriptionsForUserFromDb,
  listPushUsersFromDb,
  registerNotificationEventInDb,
  setNotificationStatusInDb
} from "../services/postgres";
import { MemoryStore } from "../services/store";
import type { AlertRuleRecord, Env, PushQueueMessage } from "../types";

const DEFAULT_BREAKING_SCAN_LIMIT = 25;
const MAX_BREAKING_SCAN_LIMIT = 100;

function allowInMemoryPushFallback(env: Env): boolean {
  return env.TEST_AUTH_BYPASS === "1";
}

function normalizeRuleValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function matchesRule(rule: AlertRuleRecord, item: FeedItemPayload): boolean {
  switch (rule.rule_type) {
    case "breaking":
      return true;
    case "macro":
      return item.item_type === "macro_update";
    case "entity": {
      const target = normalizeRuleValue(rule.rule.slug ?? rule.rule.entity).toLowerCase();
      if (!target) {
        return false;
      }
      return item.entities.some((entity) => entity.slug.toLowerCase() === target);
    }
    case "ticker": {
      const target = normalizeRuleValue(rule.rule.ticker ?? rule.rule.symbol).toUpperCase();
      if (!target) {
        return false;
      }
      return item.entities.some((entity) => (entity.primary_ticker ?? "").toUpperCase() === target);
    }
    case "filing_form": {
      if (!(item.item_type === "sec_filing" || item.item_type === "fact_flash")) {
        return false;
      }
      const target = normalizeRuleValue(rule.rule.form_type ?? rule.rule.form).toUpperCase();
      if (!target) {
        return true;
      }
      return item.headline.toUpperCase().includes(target);
    }
    default:
      return false;
  }
}

function shouldDispatchItem(rules: AlertRuleRecord[], item: FeedItemPayload): boolean {
  const enabledRules = rules.filter((rule) => rule.enabled);
  if (enabledRules.length === 0) {
    return false;
  }
  return enabledRules.some((rule) => matchesRule(rule, item));
}

function toNotificationPayload(item: FeedItemPayload): Record<string, unknown> {
  return {
    title: item.headline,
    body: item.summary ?? "Open official source for details.",
    link: item.external_url ?? "",
    source: item.source.name,
    attribution_footer: item.license.attribution_text,
    item_type: item.item_type
  };
}

function clampLimit(value: unknown): number {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    return DEFAULT_BREAKING_SCAN_LIMIT;
  }
  return Math.min(Math.floor(asNumber), MAX_BREAKING_SCAN_LIMIT);
}

async function loadBreakingItems(env: Env, limit: number): Promise<FeedItemPayload[]> {
  const fromDb = await fetchFeedFromDb(env, {
    tab: "breaking",
    query: "",
    region: "GLOBAL",
    limit,
    offset: 0
  });

  if (fromDb) {
    return fromDb;
  }

  if (!allowInMemoryPushFallback(env)) {
    throw new Error("Persistent feed store is unavailable.");
  }

  return MemoryStore.get().listFeed("breaking").slice(0, limit);
}

async function writeAudit(env: Env, key: string, payload: Record<string, unknown>): Promise<void> {
  if (!env.AUDIT_R2) {
    return;
  }
  try {
    await env.AUDIT_R2.put(key, JSON.stringify(payload, null, 2), {
      httpMetadata: { contentType: "application/json" }
    });
  } catch (error) {
    console.error("push_audit_write_failed", error);
  }
}

export async function handlePushJob(message: PushQueueMessage, env: Env): Promise<void> {
  if (message.job !== "PUSH_FANOUT_BREAKING") {
    throw new Error(`Unsupported push job: ${message.job}`);
  }

  const limit = clampLimit(message.params.limit);
  const items = await loadBreakingItems(env, limit);
  if (items.length === 0) {
    return;
  }

  const store = MemoryStore.get();
  let queued = 0;
  let skipped = 0;
  let failed = 0;

  const userIdsFromDb = await listPushUsersFromDb(env);
  if (userIdsFromDb === undefined && !allowInMemoryPushFallback(env)) {
    throw new Error("Persistent push user store is unavailable.");
  }
  const userIds = userIdsFromDb ?? store.listPushUserIds();

  for (const userId of userIds) {
    const rulesFromDb = await listAlertRulesFromDb(env, userId);
    if (rulesFromDb === undefined && !allowInMemoryPushFallback(env)) {
      throw new Error("Persistent alert rule store is unavailable.");
    }
    const rules = (rulesFromDb ?? store.listAlertRules(userId)).filter((rule) => rule.enabled);
    if (rules.length === 0) {
      continue;
    }

    const subscriptionsFromDb = await listPushSubscriptionsForUserFromDb(env, userId);
    if (subscriptionsFromDb === undefined && !allowInMemoryPushFallback(env)) {
      throw new Error("Persistent push subscription store is unavailable.");
    }
    const subscriptions = subscriptionsFromDb ?? store.listPushSubscriptions(userId);
    if (subscriptions.length === 0) {
      continue;
    }

    for (const item of items) {
      if (!shouldDispatchItem(rules, item)) {
        continue;
      }

      const payload = toNotificationPayload(item);
      const dbEvent = await registerNotificationEventInDb(env, {
        userId,
        itemId: item.item_id,
        payload
      });

      if (dbEvent === undefined && !allowInMemoryPushFallback(env)) {
        throw new Error("Persistent notification event store is unavailable.");
      }

      const event = dbEvent === undefined ? store.registerNotificationEvent(userId, item.item_id, payload) : dbEvent;
      if (!event) {
        skipped += 1;
        continue;
      }

      try {
        const dbUpdated = await setNotificationStatusInDb(env, event.notification_id, "sent");
        if (dbUpdated === undefined && !allowInMemoryPushFallback(env)) {
          throw new Error("Persistent notification status store is unavailable.");
        }
        if (dbUpdated !== true) {
          store.setNotificationStatus(event.notification_id, "sent");
        }
        queued += 1;

        await writeAudit(env, `push/${event.notification_id}.json`, {
          run_id: message.run_id,
          notification_id: event.notification_id,
          user_id: userId,
          item_id: item.item_id,
          payload
        });
      } catch (error) {
        failed += 1;
        const dbUpdated = await setNotificationStatusInDb(env, event.notification_id, "failed");
        if (dbUpdated === undefined && !allowInMemoryPushFallback(env)) {
          throw error;
        }
        if (dbUpdated !== true) {
          store.setNotificationStatus(event.notification_id, "failed");
        }
        console.error("push_dispatch_failed", error);
      }
    }
  }

  console.log("push_fanout_completed", {
    run_id: message.run_id,
    queued,
    skipped,
    failed
  });
}
