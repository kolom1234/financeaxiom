#!/usr/bin/env node
/*
 * Release gate. Compliance is verified by *behaviour*:
 *   1. the worker compliance suite (pure gates + real-Postgres checks of
 *      license exposure, GDELT attribution, raw-value preservation, RLS),
 *   2. the real-Postgres API/ingest suites,
 * plus configuration checks that cannot be expressed as unit tests.
 * Monetization readiness (ads.txt / sellers.json) is reported as a warning,
 * not a pass, while no seller is configured.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
let failures = 0;

function report(ok, id, detail = "") {
  console[ok ? "log" : "error"](`[${ok ? "PASS" : "FAIL"}] ${id}${detail ? ` - ${detail}` : ""}`);
  if (!ok) {
    failures += 1;
  }
}

function runSuite(id, args) {
  const result = spawnSync("npx", ["vitest", "run", "--config", "vitest.config.ts", ...args], {
    cwd: path.join(root, "apps", "worker"),
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  report(result.status === 0, id);
}

runSuite("Compliance suite (gates + real-schema exposure/attribution/RLS checks)", ["test/compliance"]);
runSuite("Real-Postgres API and ingestion suites", ["test/db"]);

// Security headers served by Cloudflare Pages.
const headers = read("apps/web/public/_headers");
const csp = /Content-Security-Policy:\s*(.+)/.exec(headers)?.[1] ?? "";
const scriptSrc = /script-src([^;]*)/.exec(csp)?.[1]?.trim() ?? "";
report(
  scriptSrc.length > 0 && !/unsafe-inline|unsafe-eval|(^|\s)https:(\s|$)|\*/.test(scriptSrc),
  "CSP script-src allows no inline/eval/wildcard sources",
  `script-src ${scriptSrc || "(missing)"}`
);

// Queue consumers must dead-letter instead of dropping failed messages.
const wrangler = read("apps/worker/wrangler.toml");
const consumers = wrangler.split("[[queues.consumers]]").slice(1);
report(
  consumers.length > 0 && consumers.every((block) => /dead_letter_queue\s*=/.test(block) && /max_retries\s*=/.test(block)),
  "Every queue consumer has max_retries and a dead_letter_queue"
);

// Production seed must not contain sample (fabricated) content.
const seed = read("supabase/seed.sql");
report(!/insert into (content_items|series_observations|filings)\b/i.test(seed), "seed.sql contains reference data only (no sample content)");

// Monetization readiness: informative only.
const adsLines = read("apps/web/public/ads.txt")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
const sellers = JSON.parse(read("apps/web/public/sellers.json")).sellers ?? [];
if (adsLines.length === 0 || sellers.length === 0) {
  console.warn("[WARN] Monetization not configured: ads.txt has no seller lines and/or sellers.json has no sellers.");
} else {
  console.log(`[INFO] ads.txt seller lines: ${adsLines.length}, sellers.json entries: ${sellers.length}`);
}

if (failures > 0) {
  console.error(`Release gate failed (${failures} check(s)).`);
  process.exit(1);
}
console.log("Release gate passed.");
