import { AuthError, requireUserId } from "../services/auth";
import { cacheGetJson, cachePutJson } from "../services/cache";
import { checkRateLimit, rateLimitKey, type RateLimitConfig } from "../services/rateLimit";
import { errorJson, okJson, readJsonWithLimit, RequestBodyError } from "./utils";
import type { Env } from "../types";

type AuditOutcome = "success" | "failure";
type AuditAction =
  | "signup"
  | "login"
  | "logout"
  | "password_reset_request"
  | "password_change"
  | "rules_load"
  | "rule_add"
  | "token_copy"
  | "token_view";

interface AuditPayload {
  action?: AuditAction;
  outcome?: AuditOutcome;
  details?: string;
  email?: string;
}

interface AccountAuditEvent {
  id: string;
  at: string;
  action: AuditAction;
  outcome: AuditOutcome;
  details?: string;
  email?: string;
  source: "local" | "server";
}

const AUDIT_KEY_PREFIX = "account:audit";
const AUDIT_TTL_SECONDS = 60 * 60 * 24 * 30;
const AUDIT_LIMIT = 30;
const AUDIT_RATE_LIMIT_GET: RateLimitConfig = { limit: 120, windowMs: 60 * 1000 };
const AUDIT_RATE_LIMIT_POST: RateLimitConfig = { limit: 60, windowMs: 60 * 1000 };
const AUDIT_RATE_SCOPE = "account_audit";
const AUDIT_BODY_MAX_BYTES = 4 * 1024;

function formatRateLimitSeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1000));
}

function normalizeAuditAction(value: string): AuditAction | null {
  if (
    value === "signup" ||
    value === "login" ||
    value === "logout" ||
    value === "password_reset_request" ||
    value === "password_change" ||
    value === "rules_load" ||
    value === "rule_add" ||
    value === "token_copy" ||
    value === "token_view"
  ) {
    return value;
  }
  return null;
}

function normalizeAuditOutcome(value: string): AuditOutcome {
  return value === "failure" ? "failure" : "success";
}

async function readAuditEvents(
  kv: NonNullable<Env["OFP_KV"]> | undefined,
  userId: string
): Promise<AccountAuditEvent[]> {
  if (!kv) {
    return [];
  }
  const raw = await cacheGetJson<AccountAuditEvent[]>(
    kv,
    `${AUDIT_KEY_PREFIX}:${userId}`
  );
  if (!raw || !Array.isArray(raw)) {
    return [];
  }
  return raw;
}

function toServerEvent(payload: AuditPayload): AccountAuditEvent | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const action = normalizeAuditAction(payload.action as string);
  if (!action) {
    return null;
  }
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    action,
    outcome: normalizeAuditOutcome(String(payload.outcome)),
    details: typeof payload.details === "string" ? payload.details.slice(0, 140) : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
    source: "server"
  };
}

export async function handleAccountAuditGet(request: Request, env: Env): Promise<Response> {
  try {
    const userId = await requireUserId(request, env);
    if (!env.RATE_LIMITER_DO) {
      return errorJson(request, env, 503, "Rate limiter is not configured.");
    }

    const limit = await checkRateLimit(
      env.OFP_KV,
      rateLimitKey("get", userId, AUDIT_RATE_SCOPE),
      AUDIT_RATE_LIMIT_GET,
      Date.now(),
      env.RATE_LIMITER_DO
    );
    if (!limit.allowed) {
      return errorJson(
        request,
        env,
        429,
        `Account audit endpoint is rate limited. Retry after ${formatRateLimitSeconds(limit.retryAfterMs)} seconds.`,
        { "retry-after": String(formatRateLimitSeconds(limit.retryAfterMs)) }
      );
    }

    if (!env.OFP_KV) {
      return errorJson(request, env, 503, "Audit store is not configured.");
    }
    const events = await readAuditEvents(env.OFP_KV, userId);
    return okJson(request, env, { events: events.slice(0, AUDIT_LIMIT) });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorJson(request, env, 401, error.message);
    }
    return errorJson(request, env, 500, "Unable to read account audit log.");
  }
}

export async function handleAccountAuditPost(request: Request, env: Env): Promise<Response> {
  try {
    const userId = await requireUserId(request, env);
    if (!env.OFP_KV) {
      return errorJson(request, env, 503, "Audit store is not configured.");
    }
    if (!env.RATE_LIMITER_DO) {
      return errorJson(request, env, 503, "Rate limiter is not configured.");
    }

    const limit = await checkRateLimit(
      env.OFP_KV,
      rateLimitKey("post", userId, AUDIT_RATE_SCOPE),
      AUDIT_RATE_LIMIT_POST,
      Date.now(),
      env.RATE_LIMITER_DO
    );
    if (!limit.allowed) {
      return errorJson(
        request,
        env,
        429,
        `Account audit writes are rate limited. Retry after ${formatRateLimitSeconds(limit.retryAfterMs)} seconds.`,
        { "retry-after": String(formatRateLimitSeconds(limit.retryAfterMs)) }
      );
    }
    const payload = await readJsonWithLimit<AuditPayload>(request, AUDIT_BODY_MAX_BYTES);
    const event = toServerEvent(payload);
    if (!event) {
      return errorJson(request, env, 400, "Invalid audit payload.");
    }

    const key = `${AUDIT_KEY_PREFIX}:${userId}`;
    const events = await readAuditEvents(env.OFP_KV, userId);
    events.unshift(event);
    const limited = events.slice(0, AUDIT_LIMIT);
    await cachePutJson(env.OFP_KV, key, limited, AUDIT_TTL_SECONDS);

    return okJson(request, env, {
      events: limited,
      count: limited.length
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorJson(request, env, 401, error.message);
    }
    if (error instanceof RequestBodyError) {
      return errorJson(request, env, error.status, error.message);
    }
    return errorJson(request, env, 500, "Unable to store account audit log.");
  }
}
