import { AuthError, requireUserId } from "../services/auth";
import { encryptField } from "../services/crypto";
import { sha256Hex } from "../services/hash";
import { removePushSubscriptionInDb, upsertPushSubscriptionInDb } from "../services/postgres";
import { checkRateLimit, rateLimitKey, type RateLimitConfig } from "../services/rateLimit";
import { MemoryStore } from "../services/store";
import { clientIp, errorJson, okJson, readJsonWithLimit, RequestBodyError } from "./utils";
import type { Env } from "../types";

interface PushSubscribeBody {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  filters?: Record<string, unknown>;
}

interface PushUnsubscribeBody {
  endpoint: string;
}

const PUSH_SUBSCRIBE_BODY_MAX_BYTES = 16 * 1024;
const PUSH_UNSUBSCRIBE_BODY_MAX_BYTES = 4 * 1024;
const PUSH_SUBSCRIBE_LIMIT: RateLimitConfig = { limit: 30, windowMs: 60 * 1000 };
const PUSH_UNSUBSCRIBE_LIMIT: RateLimitConfig = { limit: 60, windowMs: 60 * 1000 };
const PUSH_RATE_SCOPE = "push_subscriptions";

function formatRateLimitSeconds(milliseconds: number): string {
  return String(Math.max(1, Math.ceil(milliseconds / 1000)));
}

function allowInMemoryPushFallback(env: Env): boolean {
  return env.TEST_AUTH_BYPASS === "1";
}

export async function handlePushSubscribe(request: Request, env: Env): Promise<Response> {
  try {
    const userId = await requireUserId(request, env);
    if (!env.RATE_LIMITER_DO) {
      return errorJson(request, env, 503, "Rate limiter is not configured.");
    }
    const limit = await checkRateLimit(
      env.OFP_KV,
      rateLimitKey("subscribe", `${userId}:${clientIp(request)}`, PUSH_RATE_SCOPE),
      PUSH_SUBSCRIBE_LIMIT,
      Date.now(),
      env.RATE_LIMITER_DO
    );
    if (!limit.allowed) {
      return errorJson(
        request,
        env,
        429,
        `Push subscribe is rate limited. Retry in ${formatRateLimitSeconds(limit.retryAfterMs)} seconds.`,
        { "retry-after": formatRateLimitSeconds(limit.retryAfterMs) }
      );
    }
    if (!env.PUSH_DATA_ENC_KEY) {
      return errorJson(request, env, 500, "PUSH_DATA_ENC_KEY not configured.");
    }

    const body = await readJsonWithLimit<PushSubscribeBody>(request, PUSH_SUBSCRIBE_BODY_MAX_BYTES);
    if (!body?.endpoint || !body.keys?.auth || !body.keys?.p256dh) {
      return errorJson(request, env, 400, "Invalid subscription payload.");
    }

    const endpointHash = await sha256Hex(body.endpoint);
    const encryptedEndpoint = await encryptField(body.endpoint, env.PUSH_DATA_ENC_KEY);
    const encryptedP256dh = await encryptField(body.keys.p256dh, env.PUSH_DATA_ENC_KEY);
    const encryptedAuth = await encryptField(body.keys.auth, env.PUSH_DATA_ENC_KEY);

    const recordFromDb = await upsertPushSubscriptionInDb(env, {
      userId,
      endpointHash,
      endpointEnc: encryptedEndpoint.ciphertext,
      p256dhEnc: encryptedP256dh.ciphertext,
      authEnc: encryptedAuth.ciphertext,
      encIv: encryptedEndpoint.iv,
      filters: body.filters ?? {}
    });

    if (recordFromDb) {
      return okJson(request, env, { subscription_id: recordFromDb.subscription_id });
    }

    if (!allowInMemoryPushFallback(env)) {
      return errorJson(request, env, 503, "Persistent push subscription store is unavailable.");
    }

    const record = MemoryStore.get().upsertPushSubscription({
      user_id: userId,
      endpoint_hash: endpointHash,
      endpoint_enc: encryptedEndpoint.ciphertext,
      p256dh_enc: encryptedP256dh.ciphertext,
      auth_enc: encryptedAuth.ciphertext,
      enc_iv: encryptedEndpoint.iv,
      filters: body.filters ?? {}
    });

    return okJson(request, env, { subscription_id: record.subscription_id });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorJson(request, env, 401, error.message);
    }
    if (error instanceof RequestBodyError) {
      return errorJson(request, env, error.status, error.message);
    }
    return errorJson(request, env, 400, error instanceof Error ? error.message : "Unable to subscribe push.");
  }
}

export async function handlePushUnsubscribe(request: Request, env: Env): Promise<Response> {
  try {
    const userId = await requireUserId(request, env);
    if (!env.RATE_LIMITER_DO) {
      return errorJson(request, env, 503, "Rate limiter is not configured.");
    }
    const limit = await checkRateLimit(
      env.OFP_KV,
      rateLimitKey("unsubscribe", `${userId}:${clientIp(request)}`, PUSH_RATE_SCOPE),
      PUSH_UNSUBSCRIBE_LIMIT,
      Date.now(),
      env.RATE_LIMITER_DO
    );
    if (!limit.allowed) {
      return errorJson(
        request,
        env,
        429,
        `Push unsubscribe is rate limited. Retry in ${formatRateLimitSeconds(limit.retryAfterMs)} seconds.`,
        { "retry-after": formatRateLimitSeconds(limit.retryAfterMs) }
      );
    }
    const body = await readJsonWithLimit<PushUnsubscribeBody>(request, PUSH_UNSUBSCRIBE_BODY_MAX_BYTES);
    if (!body?.endpoint) {
      return errorJson(request, env, 400, "Invalid unsubscribe payload.");
    }
    const endpointHash = await sha256Hex(body.endpoint);
    const removedFromDb = await removePushSubscriptionInDb(env, userId, endpointHash);
    if (removedFromDb === undefined && !allowInMemoryPushFallback(env)) {
      return errorJson(request, env, 503, "Persistent push subscription store is unavailable.");
    }
    const removed = removedFromDb ?? MemoryStore.get().removePushSubscription(userId, endpointHash);
    return okJson(request, env, { removed });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorJson(request, env, 401, error.message);
    }
    if (error instanceof RequestBodyError) {
      return errorJson(request, env, error.status, error.message);
    }
    return errorJson(request, env, 400, error instanceof Error ? error.message : "Unable to unsubscribe push.");
  }
}
