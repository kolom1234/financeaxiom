function decodeBase64(input: string): Uint8Array {
  return Uint8Array.from(Buffer.from(input, "base64"));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function encodeBase64(input: Uint8Array): string {
  return Buffer.from(input).toString("base64");
}

async function importAesKey(base64Key: string): Promise<CryptoKey> {
  const keyBytes = decodeBase64(base64Key);
  if (keyBytes.byteLength !== 32) {
    throw new Error("PUSH_DATA_ENC_KEY must decode to 32 bytes for AES-256-GCM.");
  }
  return crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptField(plaintext: string, base64Key: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await importAesKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return {
    ciphertext: encodeBase64(new Uint8Array(encrypted)),
    iv: encodeBase64(iv)
  };
}

export async function decryptField(ciphertext: string, ivBase64: string, base64Key: string): Promise<string> {
  const key = await importAesKey(base64Key);
  const iv = decodeBase64(ivBase64);
  const encrypted = decodeBase64(ciphertext);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(encrypted));
  return new TextDecoder().decode(decrypted);
}
