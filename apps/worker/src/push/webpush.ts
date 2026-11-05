/**
 * Web Push delivery using only WebCrypto (works in Cloudflare Workers).
 *  - RFC 8291: message encryption ("aes128gcm" content coding, RFC 8188).
 *  - RFC 8292: VAPID authentication (ES256 JWT).
 */

const encoder = new TextEncoder();
const RECORD_SIZE = 4096;
/** 4096-byte record minus 16-byte tag minus 1-byte padding delimiter. */
export const MAX_PUSH_PLAINTEXT_BYTES = RECORD_SIZE - 16 - 1 - 86;

export function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function base64UrlDecode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", toBuffer(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: toBuffer(salt), info: toBuffer(info) },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

/** JWK for a P-256 key from its raw uncompressed public point (and optional private scalar). */
function p256Jwk(publicKey: Uint8Array, privateKey?: Uint8Array): JsonWebKey {
  if (publicKey.byteLength !== 65 || publicKey[0] !== 0x04) {
    throw new Error("P-256 public key must be a 65-byte uncompressed point.");
  }
  return {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(publicKey.slice(1, 33)),
    y: base64UrlEncode(publicKey.slice(33, 65)),
    ...(privateKey ? { d: base64UrlEncode(privateKey) } : {}),
    ext: true
  };
}

export interface ServerKeyMaterial {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * Encrypts `plaintext` for a subscription (RFC 8291 §3.4 / §4).
 * `serverKeys` and `salt` are random per message; they are injectable only so
 * the implementation can be verified against the RFC 8291 Appendix A vector.
 */
export async function encryptPushPayload(
  plaintext: Uint8Array,
  uaPublicKey: Uint8Array,
  authSecret: Uint8Array,
  options: { serverKeys?: ServerKeyMaterial; salt?: Uint8Array } = {}
): Promise<Uint8Array> {
  if (plaintext.byteLength > MAX_PUSH_PLAINTEXT_BYTES) {
    throw new Error(`Push payload too large (${plaintext.byteLength} bytes).`);
  }
  if (authSecret.byteLength !== 16) {
    throw new Error("Push auth secret must be 16 bytes.");
  }
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));

  let asPublic: Uint8Array;
  let asPrivateKey: CryptoKey;
  if (options.serverKeys) {
    asPublic = options.serverKeys.publicKey;
    asPrivateKey = await crypto.subtle.importKey(
      "jwk",
      p256Jwk(options.serverKeys.publicKey, options.serverKeys.privateKey),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"]
    );
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    asPrivateKey = pair.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  }

  const uaKey = await crypto.subtle.importKey("jwk", p256Jwk(uaPublicKey), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as EcdhKeyDeriveParams, asPrivateKey, 256));

  // IKM = HKDF(salt=auth_secret, ikm=ecdh_secret, info="WebPush: info" || 0x00 || ua_public || as_public, L=32)
  const keyInfo = concat(encoder.encode("WebPush: info\0"), uaPublicKey, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", toBuffer(cek), "AES-GCM", false, ["encrypt"]);
  // Single record: plaintext followed by the 0x02 "last record" padding delimiter.
  const record = concat(plaintext, new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: toBuffer(nonce) }, aesKey, toBuffer(record)));

  // RFC 8188 header: salt(16) || rs(uint32 BE) || idlen(1) || keyid(as_public, 65)
  const header = new Uint8Array(16 + 4 + 1 + asPublic.byteLength);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false);
  header[20] = asPublic.byteLength;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function vapidConfigFrom(env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string }): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject || !/^(mailto:|https:)/.test(subject)) {
    return null;
  }
  return { publicKey, privateKey, subject };
}

/** `Authorization: vapid t=<JWT>, k=<public key>` for the endpoint's origin (RFC 8292 §3). */
export async function vapidAuthorization(endpoint: string, vapid: VapidConfig, nowMs = Date.now()): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64UrlEncode(
    encoder.encode(JSON.stringify({ aud: audience, exp: Math.floor(nowMs / 1000) + 12 * 60 * 60, sub: vapid.subject }))
  );
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "jwk",
    p256Jwk(base64UrlDecode(vapid.publicKey), base64UrlDecode(vapid.privateKey)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  // WebCrypto returns the IEEE P1363 (r||s) signature that JWS ES256 requires.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(signingInput)));
  return `vapid t=${signingInput}.${base64UrlEncode(signature)}, k=${vapid.publicKey}`;
}

export type PushDeliveryResult =
  | { outcome: "delivered"; status: number }
  /** Subscription no longer valid (404/410): delete it. */
  | { outcome: "gone"; status: number }
  | { outcome: "failed"; status: number; retryable: boolean };

export async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: Record<string, unknown>,
  vapid: VapidConfig,
  options: { ttlSeconds?: number; urgency?: "very-low" | "low" | "normal" | "high" } = {}
): Promise<PushDeliveryResult> {
  const body = await encryptPushPayload(
    encoder.encode(JSON.stringify(payload)),
    base64UrlDecode(subscription.p256dh),
    base64UrlDecode(subscription.auth)
  );
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(options.ttlSeconds ?? 24 * 60 * 60),
      Urgency: options.urgency ?? "normal"
    },
    body: toBuffer(body)
  });
  if (response.status >= 200 && response.status < 300) {
    return { outcome: "delivered", status: response.status };
  }
  if (response.status === 404 || response.status === 410) {
    return { outcome: "gone", status: response.status };
  }
  return { outcome: "failed", status: response.status, retryable: response.status === 429 || response.status >= 500 };
}
