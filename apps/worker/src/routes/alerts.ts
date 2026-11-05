import { z } from "zod";
import { requireUserId } from "../services/auth";
import { hasDatabase } from "../services/db";
import { deleteAlertRule, listAlertRules, saveAlertRule } from "../services/postgres";
import { checkRateLimit, rateLimitKey, type RateLimitConfig } from "../services/rateLimit";
import { MemoryStore } from "../services/store";
import { entitySlug, parsePathParam, uuid } from "./schemas";
import { HttpError, formatRetryAfterSeconds, okJson, readValidatedBody } from "./utils";
import type { Env } from "../types";

const ALERTS_GET_LIMIT: RateLimitConfig = { limit: 120, windowMs: 60 * 1000 };
const ALERTS_WRITE_LIMIT: RateLimitConfig = { limit: 60, windowMs: 60 * 1000 };
const ALERTS_RATE_SCOPE = "alerts";
const ALERT_RULE_BODY_MAX_BYTES = 8 * 1024;
export const MAX_ALERT_RULES_PER_USER = 50;

const common = {
  rule_id: uuid.optional(),
  enabled: z.boolean()
};

/** One schema per rule type; unknown keys inside `rule` are stripped. */
const AlertRuleBodySchema = z.discriminatedUnion("rule_type", [
  z.object({ ...common, rule_type: z.literal("breaking"), rule: z.object({ tab: z.literal("breaking").optional() }) }),
  z.object({ ...common, rule_type: z.literal("macro"), rule: z.object({}) }),
  z.object({ ...common, rule_type: z.literal("entity"), rule: z.object({ slug: entitySlug }) }),
  z.object({
    ...common,
    rule_type: z.literal("ticker"),
    rule: z.object({
      ticker: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z][A-Z0-9.]{0,9}$/, "invalid ticker")
    })
  }),
  z.object({
    ...common,
    rule_type: z.literal("filing_form"),
    rule: z.object({
      form_type: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9][A-Z0-9/-]{0,14}$/, "invalid SEC form type")
        .optional()
    })
  })
]);

function useMemoryStore(env: Env): boolean {
  if (hasDatabase(env)) {
    return false;
  }
  if (env.TEST_AUTH_BYPASS === "1") {
    return true;
  }
  throw new HttpError(503, "Persistent alert rule store is unavailable.");
}

async function enforceLimit(env: Env, userId: string, action: string, config: RateLimitConfig): Promise<void> {
  if (!env.RATE_LIMITER_DO) {
    throw new HttpError(503, "Rate limiter is not configured.");
  }
  const limit = await checkRateLimit(env.OFP_KV, rateLimitKey(action, userId, ALERTS_RATE_SCOPE), config, Date.now(), env.RATE_LIMITER_DO);
  if (!limit.allowed) {
    const seconds = formatRetryAfterSeconds(limit.retryAfterMs);
    throw new HttpError(429, `Alert rules ${action === "get" ? "read" : "write"} is rate limited. Retry after ${seconds} seconds.`, {
      "retry-after": seconds
    });
  }
}

export async function handleAlertsGet(request: Request, env: Env): Promise<Response> {
  const userId = await requireUserId(request, env);
  await enforceLimit(env, userId, "get", ALERTS_GET_LIMIT);
  const rules = useMemoryStore(env) ? MemoryStore.get().listAlertRules(userId) : await listAlertRules(env, userId);
  return okJson(request, env, { rules, max_rules: MAX_ALERT_RULES_PER_USER });
}

export async function handleAlertsPost(request: Request, env: Env): Promise<Response> {
  const userId = await requireUserId(request, env);
  await enforceLimit(env, userId, "post", ALERTS_WRITE_LIMIT);
  const body = await readValidatedBody(request, AlertRuleBodySchema, ALERT_RULE_BODY_MAX_BYTES);
  const input = { rule_id: body.rule_id, rule_type: body.rule_type, rule: body.rule as Record<string, unknown>, enabled: body.enabled };

  const result = useMemoryStore(env)
    ? MemoryStore.get().saveAlertRule(userId, input, MAX_ALERT_RULES_PER_USER)
    : await saveAlertRule(env, userId, input, MAX_ALERT_RULES_PER_USER);

  if (result.status === "not_found") {
    throw new HttpError(404, "Alert rule not found.");
  }
  if (result.status === "limit_reached") {
    throw new HttpError(409, `Alert rule limit reached (${MAX_ALERT_RULES_PER_USER} per account).`);
  }
  return okJson(request, env, { rule: result.rule }, undefined, body.rule_id ? 200 : 201);
}

export async function handleAlertsDelete(request: Request, env: Env, rawRuleId: string): Promise<Response> {
  const userId = await requireUserId(request, env);
  const ruleId = parsePathParam(uuid, rawRuleId);
  if (!ruleId) {
    throw new HttpError(400, "Invalid alert rule id.");
  }
  await enforceLimit(env, userId, "post", ALERTS_WRITE_LIMIT);
  const deleted = useMemoryStore(env) ? MemoryStore.get().deleteAlertRule(userId, ruleId) : await deleteAlertRule(env, userId, ruleId);
  if (!deleted) {
    throw new HttpError(404, "Alert rule not found.");
  }
  return okJson(request, env, { deleted: true });
}
