import type { Env } from "../types";
import { describeError, logEvent } from "./log";

export type AuditOutcome = "success" | "failure";
export type AuditAction =
  | "signup"
  | "login"
  | "logout"
  | "password_reset_request"
  | "password_change"
  | "rules_load"
  | "rule_add"
  | "rule_delete"
  | "push_subscribe"
  | "account_delete"
  | "token_copy"
  | "token_view";

export interface AccountAuditEvent {
  id: string;
  at: string;
  action: AuditAction;
  outcome: AuditOutcome;
  details?: string;
  /**
   * "server": recorded by the worker itself after an operation it performed.
   * "client": reported by the browser; informational only, not verified.
   */
  source: "server" | "client";
}

export const AUDIT_TTL_SECONDS = 60 * 60 * 24 * 30;
export const AUDIT_LIMIT = 30;
const MAX_TIMESTAMP = 9_999_999_999_999;
const LEGACY_PREFIX = "account:audit:";

function prefixFor(userId: string): string {
  return `account:audit:v2:${userId}:`;
}

/**
 * One KV key per event (event stored as key metadata), newest first via an
 * inverted timestamp. Unlike a read-modify-write list, concurrent writes can
 * never drop each other's events.
 */
export async function appendAuditEvent(
  env: Env,
  userId: string,
  event: Omit<AccountAuditEvent, "id" | "at">
): Promise<AccountAuditEvent | null> {
  const kv = env.OFP_KV;
  if (!kv) {
    return null;
  }
  const now = Date.now();
  const full: AccountAuditEvent = {
    id: crypto.randomUUID(),
    at: new Date(now).toISOString(),
    ...event,
    ...(event.details ? { details: event.details.slice(0, 140) } : {})
  };
  const key = `${prefixFor(userId)}${String(MAX_TIMESTAMP - now).padStart(13, "0")}:${full.id}`;
  await kv.put(key, "", { expirationTtl: AUDIT_TTL_SECONDS, metadata: full });
  return full;
}

/** Best-effort server-side record; failures are logged, never surfaced to the caller. */
export async function recordServerAudit(
  env: Env,
  userId: string | null | undefined,
  action: AuditAction,
  outcome: AuditOutcome,
  details?: string
): Promise<void> {
  if (!userId) {
    return;
  }
  try {
    await appendAuditEvent(env, userId, { action, outcome, details, source: "server" });
  } catch (error) {
    logEvent("warn", "audit_write_failed", { action, ...describeError(error) });
  }
}

function isAuditEvent(value: unknown): value is AccountAuditEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.at === "string" && typeof candidate.action === "string";
}

export async function listAuditEvents(env: Env, userId: string): Promise<AccountAuditEvent[]> {
  const kv = env.OFP_KV;
  if (!kv) {
    return [];
  }
  const listed = await kv.list<AccountAuditEvent>({ prefix: prefixFor(userId), limit: AUDIT_LIMIT });
  const events = listed.keys.map((key) => key.metadata).filter(isAuditEvent);

  // Events written before v2 lived in a single JSON list; include them until they expire.
  const legacyRaw = await kv.get(`${LEGACY_PREFIX}${userId}`);
  if (legacyRaw) {
    try {
      const legacy = JSON.parse(legacyRaw) as unknown[];
      for (const entry of Array.isArray(legacy) ? legacy : []) {
        if (isAuditEvent(entry)) {
          events.push({ ...entry, source: "client" });
        }
      }
    } catch {
      // ignore malformed legacy data
    }
  }

  return events.sort((left, right) => right.at.localeCompare(left.at)).slice(0, AUDIT_LIMIT);
}

export async function deleteAuditEvents(env: Env, userId: string): Promise<number> {
  const kv = env.OFP_KV;
  if (!kv) {
    return 0;
  }
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: prefixFor(userId), cursor });
    for (const key of page.keys) {
      await kv.delete(key.name);
      deleted += 1;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  await kv.delete(`${LEGACY_PREFIX}${userId}`);
  return deleted;
}
