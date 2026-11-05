import { z } from "zod";
import { requireUserId } from "../services/auth";
import { encryptField } from "../services/crypto";
import { hasDatabase } from "../services/db";
import { sha256Hex } from "../services/hash";
import { removePushSubscription, upsertPushSubscription } from "../services/postgres";
import { checkRateLimit, rateLimitKey, type RateLimitConfig } from "../services/rateLimit";
import { MemoryStore } from "../services/store";
import { isAllowedPushEndpoint, isValidAuthSecret, isValidP256dh } from "../push/endpoints";
import { HttpError, clientIp, formatRetryAfterSeconds, okJson, readValidatedBody } from "./utils";
import type { Env } from "../types";

const PUSH_SUBSCRIBE_BODY_MAX_BYTES = 16 * 1024;
const PUSH_UNSUBSCRIBE_BODY_MAX_BYTES = 4 * 1024;
const PUSH_SUBSCRIBE_LIMIT: RateLimitConfig = { limit: 30, windowMs: 60 * 1000 };
const PUSH_UNSUBSCRIBE_LIMIT: RateLimitConfig = { limit: 60, windowMs: 60 * 1000 };
const PUSH_RATE_SCOPE = "push_subscriptions";

const endpointSchema = z
  .string()
  .max(2048)
  .refine(isAllowedPushEndpoint, "endpoint must be an https URL of a supported browser push service");

const SubscribeSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: z.string().max(200).refine(isValidP256dh, "must be a base64url uncompressed P-256 public key"),
    auth: z.string().max(64).refine(isValidAuthSecret, "must be a base64url 16-byte secret")
  }),
  // Allow-listed, flat preferences only.
  filters: z.object({ tabs: z.array(z.enum(["breaking", "filings", "macro"])).max(3).optional() }).default({})
});

const UnsubscribeSchema = z.object({ endpoint: z.string().max(2048).min(1) });

function useMemoryStore(env: Env): boolean {
  if (hasDatabase(env)) {
    return false;
  }
  if (env.TEST_AUTH_BYPASS === "1") {
    return true;
  }
  throw new HttpError(503, "Persistent push subscription store is unavailable.");
}

async function enforceLimit(request: Request, env: Env, userId: string, action: string, config: RateLimitConfig): Promise<void> {
  if (!env.RATE_LIMITER_DO) {
    throw new HttpError(503, "Rate limiter is not configured.");
  }
  const limit = await checkRateLimit(
    env.OFP_KV,
    rateLimitKey(action, `${userId}:${clientIp(request)}`, PUSH_RATE_SCOPE),
    config,
    Date.now(),
    env.RATE_LIMITER_DO
  );
  if (!limit.allowed) {
    const seconds = formatRetryAfterSeconds(limit.retryAfterMs);
    throw new HttpError(429, `Push ${action} is rate limited. Retry in ${seconds} seconds.`, { "retry-after": seconds });
  }
}

export async function handlePushSubscribe(request: Request, env: Env): Promise<Response> {
  const userId = await requireUserId(request, env);
  await enforceLimit(request, env, userId, "subscribe", PUSH_SUBSCRIBE_LIMIT);
  if (!env.PUSH_DATA_ENC_KEY) {
    throw new HttpError(503, "Push notifications are not configured.");
  }

  const body = await readValidatedBody(request, SubscribeSchema, PUSH_SUBSCRIBE_BODY_MAX_BYTES);

  // Each field gets its own random IV; all three IVs are stored.
  const endpointHash = await sha256Hex(body.endpoint);
  const endpoint = await encryptField(body.endpoint, env.PUSH_DATA_ENC_KEY);
  const p256dh = await encryptField(body.keys.p256dh, env.PUSH_DATA_ENC_KEY);
  const auth = await encryptField(body.keys.auth, env.PUSH_DATA_ENC_KEY);
  const record = {
    endpointHash,
    endpointEnc: endpoint.ciphertext,
    endpointIv: endpoint.iv,
    p256dhEnc: p256dh.ciphertext,
    p256dhIv: p256dh.iv,
    authEnc: auth.ciphertext,
    authIv: auth.iv,
    filters: body.filters
  };

  if (useMemoryStore(env)) {
    const saved = MemoryStore.get().upsertPushSubscription({
      user_id: userId,
      endpoint_hash: record.endpointHash,
      endpoint_enc: record.endpointEnc,
      endpoint_iv: record.endpointIv,
      p256dh_enc: record.p256dhEnc,
      p256dh_iv: record.p256dhIv,
      auth_enc: record.authEnc,
      auth_iv: record.authIv,
      filters: record.filters
    });
    return okJson(request, env, { subscription_id: saved.subscription_id });
  }

  const saved = await upsertPushSubscription(env, { userId, ...record });
  return okJson(request, env, { subscription_id: saved.subscription_id });
}

export async function handlePushUnsubscribe(request: Request, env: Env): Promise<Response> {
  const userId = await requireUserId(request, env);
  await enforceLimit(request, env, userId, "unsubscribe", PUSH_UNSUBSCRIBE_LIMIT);
  const body = await readValidatedBody(request, UnsubscribeSchema, PUSH_UNSUBSCRIBE_BODY_MAX_BYTES);
  const endpointHash = await sha256Hex(body.endpoint);
  const removed = useMemoryStore(env)
    ? MemoryStore.get().removePushSubscription(userId, endpointHash)
    : await removePushSubscription(env, userId, endpointHash);
  return okJson(request, env, { removed });
}

/** Public VAPID key the browser needs for pushManager.subscribe(). */
export async function handlePushConfig(request: Request, env: Env): Promise<Response> {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const enabled = Boolean(publicKey && env.VAPID_PRIVATE_KEY?.trim() && env.VAPID_SUBJECT?.trim() && env.PUSH_DATA_ENC_KEY);
  return okJson(request, env, { enabled, vapid_public_key: enabled ? publicKey : null });
}
