/**
 * Browser push services we will deliver to. Anything else is rejected so the
 * worker can never be used to send requests to arbitrary hosts (SSRF).
 */
const EXACT_HOSTS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);
const HOST_SUFFIXES = [".notify.windows.com", ".push.apple.com", ".push.services.mozilla.com"];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return EXACT_HOSTS.has(host) || HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function decodeBase64Url(input: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(input)) {
    return null;
  }
  try {
    return new Uint8Array(Buffer.from(input, "base64url"));
  } catch {
    return null;
  }
}

/** Uncompressed P-256 public key: 65 bytes starting with 0x04. */
export function isValidP256dh(value: string): boolean {
  const bytes = decodeBase64Url(value);
  return bytes !== null && bytes.length === 65 && bytes[0] === 0x04;
}

/** Push auth secret: 16 bytes (RFC 8291 §3.2). */
export function isValidAuthSecret(value: string): boolean {
  const bytes = decodeBase64Url(value);
  return bytes !== null && bytes.length === 16;
}
