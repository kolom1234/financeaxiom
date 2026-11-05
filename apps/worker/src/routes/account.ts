import { z } from "zod";
import { requireUserId } from "../services/auth";
import { deleteAuditEvents } from "../services/audit";
import { hasDatabase } from "../services/db";
import { describeError, logEvent } from "../services/log";
import { deleteUserData } from "../services/postgres";
import { checkRateLimit, rateLimitKey, type RateLimitConfig } from "../services/rateLimit";
import { MemoryStore } from "../services/store";
import { HttpError, formatRetryAfterSeconds, okJson, readValidatedBody } from "./utils";
import type { Env } from "../types";

const DELETE_LIMIT: RateLimitConfig = { limit: 5, windowMs: 60 * 60 * 1000 };
const DeleteSchema = z.object({ confirm: z.literal("DELETE") });

/**
 * Deletes the Supabase Auth user via the Admin API when a service-role key is
 * configured. The service-role key never leaves the worker.
 */
async function deleteAuthUser(env: Env, userId: string): Promise<boolean> {
  const baseUrl = env.SUPABASE_URL?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!baseUrl || !serviceKey) {
    return false;
  }
  const response = await fetch(`${baseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Supabase admin delete failed with ${response.status}`);
  }
  return true;
}

/**
 * POST /api/account/delete  { "confirm": "DELETE" }
 * Erases all app data owned by the caller (alert rules, push subscriptions,
 * notification history, audit log) and, if configured, the login account.
 */
export async function handleAccountDelete(request: Request, env: Env): Promise<Response> {
  const userId = await requireUserId(request, env);
  if (!env.RATE_LIMITER_DO) {
    throw new HttpError(503, "Rate limiter is not configured.");
  }
  const limit = await checkRateLimit(env.OFP_KV, rateLimitKey("delete", userId, "account"), DELETE_LIMIT, Date.now(), env.RATE_LIMITER_DO);
  if (!limit.allowed) {
    const seconds = formatRetryAfterSeconds(limit.retryAfterMs);
    throw new HttpError(429, `Account deletion is rate limited. Retry in ${seconds} seconds.`, { "retry-after": seconds });
  }
  await readValidatedBody(request, DeleteSchema, 1024);

  let removed: { push_subscriptions: number; alert_rules: number; notification_events: number };
  if (hasDatabase(env)) {
    removed = await deleteUserData(env, userId);
  } else if (env.TEST_AUTH_BYPASS === "1") {
    removed = MemoryStore.get().deleteUserData(userId);
  } else {
    throw new HttpError(503, "Persistent store is unavailable.");
  }
  const auditEvents = await deleteAuditEvents(env, userId);

  let authAccountDeleted = false;
  try {
    authAccountDeleted = await deleteAuthUser(env, userId);
  } catch (error) {
    logEvent("error", "account_auth_delete_failed", describeError(error));
    throw new HttpError(502, "App data was deleted, but the login account could not be deleted. Please retry.");
  }

  logEvent("info", "account_data_deleted", { ...removed, audit_events: auditEvents, auth_account_deleted: authAccountDeleted });
  return okJson(request, env, {
    deleted: { ...removed, audit_events: auditEvents },
    auth_account_deleted: authAccountDeleted,
    ...(authAccountDeleted ? {} : { note: "Login account deletion is not enabled on this deployment; contact support to remove it." })
  });
}
