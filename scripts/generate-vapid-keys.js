#!/usr/bin/env node
// Generates a VAPID key pair (RFC 8292) in the format the worker expects:
// VAPID_PUBLIC_KEY = base64url uncompressed P-256 point, VAPID_PRIVATE_KEY = base64url scalar.
const { webcrypto } = require("node:crypto");

(async () => {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicRaw = Buffer.from(await webcrypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
  console.log(`VAPID_PUBLIC_KEY=${publicRaw.toString("base64url")}`);
  console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
  console.log("# Store VAPID_PRIVATE_KEY as a secret: npx wrangler secret put VAPID_PRIVATE_KEY --config apps/worker/wrangler.toml");
})();
