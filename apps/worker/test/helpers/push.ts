import { encryptField } from "../../src/services/crypto";
import { MemoryStore } from "../../src/services/store";
import { base64UrlEncode } from "../../src/push/webpush";
import type { Env } from "../../src/types";

/** A real browser-shaped subscription: P-256 public key + 16-byte auth secret. */
export async function createBrowserSubscription(endpoint = "https://fcm.googleapis.com/fcm/send/test-endpoint"): Promise<{
  endpoint: string;
  keys: { p256dh: string; auth: string };
}> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const publicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  return { endpoint, keys: { p256dh: base64UrlEncode(publicRaw), auth: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))) } };
}

export async function vapidEnv(): Promise<Pick<Env, "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY" | "VAPID_SUBJECT">> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return { VAPID_PUBLIC_KEY: base64UrlEncode(publicRaw), VAPID_PRIVATE_KEY: jwk.d!, VAPID_SUBJECT: "mailto:ops@financeaxiom.com" };
}

/** Stores an encrypted subscription in the memory store exactly as the subscribe route would. */
export async function storeMemorySubscription(env: Env, userId: string, endpoint?: string): Promise<{ endpoint: string }> {
  const subscription = await createBrowserSubscription(endpoint);
  const key = env.PUSH_DATA_ENC_KEY!;
  const encEndpoint = await encryptField(subscription.endpoint, key);
  const encP256dh = await encryptField(subscription.keys.p256dh, key);
  const encAuth = await encryptField(subscription.keys.auth, key);
  MemoryStore.get().upsertPushSubscription({
    user_id: userId,
    endpoint_hash: `hash-${subscription.endpoint}`,
    endpoint_enc: encEndpoint.ciphertext,
    endpoint_iv: encEndpoint.iv,
    p256dh_enc: encP256dh.ciphertext,
    p256dh_iv: encP256dh.iv,
    auth_enc: encAuth.ciphertext,
    auth_iv: encAuth.iv,
    filters: {}
  });
  return { endpoint: subscription.endpoint };
}

export function resetMemoryPushState(): void {
  const store = MemoryStore.get();
  store.pushSubscriptions.length = 0;
  store.alertRules.length = 0;
  store.notificationEvents.length = 0;
}
