import { z } from "zod";
import { requireUserId } from "../services/auth";
import { appendAuditEvent, listAuditEvents } from "../services/audit";
import { checkRateLimit, rateLimitKey, type RateLimitConfig } from "../services/rateLimit";
import { HttpError, formatRetryAfterSeconds, okJson, readValidatedBody } from "./utils";
import type { Env } from "../types";

const AUDIT_RATE_LIMIT_GET: RateLimitConfig = { limit: 120, windowMs: 60 * 1000 };
const AUDIT_RATE_LIMIT_POST: RateLimitConfig = { limit: 60, windowMs: 60 * 1000 };
const AUDIT_RATE_SCOPE = "account_audit";
const AUDIT_BODY_MAX_BYTES = 4 * 1024;

/**
 * Browser-reported events. They are stored with source "client": the worker
 * cannot verify them. Authentication events are recorded server-side by the
 * auth gateway itself (source "server"). Unknown keys such as a free-form
 * `email` are stripped and never stored.
 */
const ClientAuditSchema = z.object({
  action: z.enum([
    "signup",
    "login",
    "logout",
    "password_reset_request",
    "password_change",
    "rules_load",
    "rule_add",
    "rule_delete",
    "push_subscribe",
    "token_copy",
    "token_view"
  ]),
  outcome: z.enum(["success", "failure"]).default("success"),
  details: z.string().max(500).optional()
});

async function enforceLimit(env: Env, userId: string, action: string, config: RateLimitConfig): Promise<void> {
  if (!env.RATE_LIMITER_DO) {
    throw new HttpError(503, "Rate limiter is not configured.");
  }
  const limit = await checkRateLimit(env.OFP_KV, rateLimitKey(action, userId, AUDIT_RATE_SCOPE), config, Date.now(), env.RATE_LIMITER_DO);
  if (!limit.allowed) {
    const seconds = formatRetryAfterSeconds(limit.retryAfterMs);
    throw new HttpError(429, `Account audit endpoint is rate limited. Retry after ${seconds} seconds.`, { "retry-after": seconds });
  }
}

export async function handleAccountAuditGet(request: Request, env: Env): Promise<Response> {
  const userId = await requireUserId(request, env);
  await enforceLimit(env, userId, "get", AUDIT_RATE_LIMIT_GET);
  if (!env.OFP_KV) {
    throw new HttpError(503, "Audit store is not configured.");
  }
  return okJson(request, env, { events: await listAuditEvents(env, userId) });
}

export async function handleAccountAuditPost(request: Request, env: Env): Promise<Response> {
  const userId = await requireUserId(request, env);
  if (!env.OFP_KV) {
    throw new HttpError(503, "Audit store is not configured.");
  }
  await enforceLimit(env, userId, "post", AUDIT_RATE_LIMIT_POST);
  const body = await readValidatedBody(request, ClientAuditSchema, AUDIT_BODY_MAX_BYTES);
  const event = await appendAuditEvent(env, userId, {
    action: body.action,
    outcome: body.outcome,
    details: body.details,
    source: "client"
  });
  const events = await listAuditEvents(env, userId);
  return okJson(request, env, { event, events, count: events.length });
}
