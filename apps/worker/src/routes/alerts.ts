import { AuthError, requireUserId } from "../services/auth";
import { listAlertRulesFromDb, saveAlertRuleInDb } from "../services/postgres";
import { checkRateLimit, rateLimitKey, type RateLimitConfig } from "../services/rateLimit";
import { MemoryStore } from "../services/store";
import { errorJson, okJson, readJsonWithLimit, RequestBodyError } from "./utils";
import type { AlertRuleRecord, Env } from "../types";

type AlertRuleInput = Pick<AlertRuleRecord, "rule_id" | "rule_type" | "rule" | "enabled">;
const ALERTS_GET_LIMIT: RateLimitConfig = { limit: 120, windowMs: 60 * 1000 };
const ALERTS_POST_LIMIT: RateLimitConfig = { limit: 60, windowMs: 60 * 1000 };
const ALERTS_RATE_SCOPE = "alerts";
const ALERT_RULE_BODY_MAX_BYTES = 8 * 1024;

function formatRateLimitSeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1000));
}

function allowInMemoryRuleFallback(env: Env): boolean {
  return env.TEST_AUTH_BYPASS === "1";
}

export async function handleAlertsGet(request: Request, env: Env): Promise<Response> {
  try {
    const userId = await requireUserId(request, env);
    if (!env.RATE_LIMITER_DO) {
      return errorJson(request, env, 503, "Rate limiter is not configured.");
    }
    const limit = await checkRateLimit(
      env.OFP_KV,
      rateLimitKey("get", userId, ALERTS_RATE_SCOPE),
      ALERTS_GET_LIMIT,
      Date.now(),
      env.RATE_LIMITER_DO
    );
    if (!limit.allowed) {
      return errorJson(
        request,
        env,
        429,
        `Alert rules read is rate limited. Retry after ${formatRateLimitSeconds(limit.retryAfterMs)} seconds.`,
        { "retry-after": String(formatRateLimitSeconds(limit.retryAfterMs)) }
      );
    }

    const fromDb = await listAlertRulesFromDb(env, userId);
    if (fromDb === undefined && !allowInMemoryRuleFallback(env)) {
      return errorJson(request, env, 503, "Persistent alert rule store is unavailable.");
    }

    const rules = fromDb ?? MemoryStore.get().listAlertRules(userId);
    return okJson(request, env, { rules });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorJson(request, env, 401, error.message);
    }
    return errorJson(request, env, 400, "Unable to fetch alert rules.");
  }
}

export async function handleAlertsPost(request: Request, env: Env): Promise<Response> {
  try {
    const userId = await requireUserId(request, env);
    if (!env.RATE_LIMITER_DO) {
      return errorJson(request, env, 503, "Rate limiter is not configured.");
    }
    const limit = await checkRateLimit(
      env.OFP_KV,
      rateLimitKey("post", userId, ALERTS_RATE_SCOPE),
      ALERTS_POST_LIMIT,
      Date.now(),
      env.RATE_LIMITER_DO
    );
    if (!limit.allowed) {
      return errorJson(
        request,
        env,
        429,
        `Alert rules write is rate limited. Retry after ${formatRateLimitSeconds(limit.retryAfterMs)} seconds.`,
        { "retry-after": String(formatRateLimitSeconds(limit.retryAfterMs)) }
      );
    }

    const body = await readJsonWithLimit<AlertRuleInput>(request, ALERT_RULE_BODY_MAX_BYTES);
    if (!body?.rule_type || !body.rule || typeof body.enabled !== "boolean") {
      return errorJson(request, env, 400, "Invalid alert rule payload.");
    }

    const savedFromDb = await saveAlertRuleInDb(env, userId, {
      rule_id: body.rule_id,
      rule_type: body.rule_type,
      rule: body.rule,
      enabled: body.enabled
    });
    if (savedFromDb) {
      return okJson(request, env, { rule: savedFromDb });
    }

    if (!allowInMemoryRuleFallback(env)) {
      return errorJson(request, env, 503, "Persistent alert rule store is unavailable.");
    }

    const saved = MemoryStore.get().saveAlertRule(userId, {
      rule_id: body.rule_id,
      rule_type: body.rule_type,
      rule: body.rule,
      enabled: body.enabled
    });
    return okJson(request, env, { rule: saved });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorJson(request, env, 401, error.message);
    }
    if (error instanceof RequestBodyError) {
      return errorJson(request, env, error.status, error.message);
    }
    return errorJson(request, env, 400, error instanceof Error ? error.message : "Unable to save alert rule.");
  }
}
