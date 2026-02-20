const fs = require("fs");
const path = require("path");
const { sha256 } = require("../compliance/generate-third-party-notices");

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

const rootDir = path.resolve(__dirname, "..", "..");
const lockfilePath = path.join(rootDir, "package-lock.json");
const noticesPath = path.join(rootDir, "THIRD_PARTY_NOTICES.txt");

if (!fs.existsSync(noticesPath)) {
  fail("THIRD_PARTY_NOTICES.txt is missing. Run `npm run gen:oss-notices`.");
}

const lockfileRaw = fs.readFileSync(lockfilePath, "utf8");
const expectedLockHash = sha256(lockfileRaw);
const notices = fs.readFileSync(noticesPath, "utf8");

const hashMatch = notices.match(/^Lockfile SHA256:\s*([a-f0-9]{64})$/m);
if (!hashMatch) {
  fail("THIRD_PARTY_NOTICES.txt does not contain a valid lockfile hash header.");
}

const noticeLockHash = hashMatch[1];
if (noticeLockHash !== expectedLockHash) {
  fail(
    `THIRD_PARTY_NOTICES.txt is stale. expected lock hash ${expectedLockHash}, found ${noticeLockHash}. Run \`npm run gen:oss-notices\`.`
  );
}

if (!notices.includes("@img/sharp-libvips-darwin-arm64@")) {
  fail("THIRD_PARTY_NOTICES.txt is missing known LGPL package @img/sharp-libvips-darwin-arm64.");
}

if (!notices.includes("LGPL-3.0-or-later")) {
  fail("THIRD_PARTY_NOTICES.txt is missing LGPL license declaration text.");
}

console.log("[PASS] OSS notices file exists and matches current lockfile");
