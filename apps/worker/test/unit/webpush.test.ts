import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode, encryptPushPayload, vapidAuthorization } from "../../src/push/webpush";

// RFC 8291 Appendix A ("Intermediate Values for Encryption"), copied verbatim.
const RFC8291 = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
};

describe("Web Push encryption (RFC 8291)", () => {
  it("reproduces the RFC 8291 Appendix A encrypted body byte-for-byte", async () => {
    const body = await encryptPushPayload(
      base64UrlDecode(RFC8291.plaintext),
      base64UrlDecode(RFC8291.uaPublic),
      base64UrlDecode(RFC8291.authSecret),
      {
        salt: base64UrlDecode(RFC8291.salt),
        serverKeys: { publicKey: base64UrlDecode(RFC8291.asPublic), privateKey: base64UrlDecode(RFC8291.asPrivate) }
      }
    );
    expect(base64UrlEncode(body)).toBe(RFC8291.body);
  });

  it("produces a fresh salt and server key per message", async () => {
    const args = [new TextEncoder().encode("hi"), base64UrlDecode(RFC8291.uaPublic), base64UrlDecode(RFC8291.authSecret)] as const;
    const first = await encryptPushPayload(...args);
    const second = await encryptPushPayload(...args);
    expect(base64UrlEncode(first.slice(0, 16))).not.toBe(base64UrlEncode(second.slice(0, 16)));
    expect(new DataView(first.buffer).getUint32(16, false)).toBe(4096);
    expect(first[20]).toBe(65);
  });
});

describe("VAPID (RFC 8292)", () => {
  it("signs an ES256 JWT for the endpoint origin that verifies with the public key", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const publicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
    const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
    const vapid = { publicKey: base64UrlEncode(publicRaw), privateKey: jwk.d!, subject: "mailto:ops@financeaxiom.com" };

    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", vapid, Date.UTC(2026, 0, 1));
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, h, c, s, k] = match!;
    expect(k).toBe(vapid.publicKey);
    const claims = JSON.parse(Buffer.from(c!, "base64url").toString("utf8"));
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: Date.UTC(2026, 0, 1) / 1000 + 43200, sub: "mailto:ops@financeaxiom.com" });
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      base64UrlDecode(s!) as Uint8Array<ArrayBuffer>,
      new TextEncoder().encode(`${h}.${c}`)
    );
    expect(valid).toBe(true);
  });
});
