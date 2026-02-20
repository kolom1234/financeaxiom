const fs = require("fs");

function has(path, pattern) {
  const content = fs.readFileSync(path, "utf8");
  return pattern.test(content);
}

function exists(path) {
  return fs.existsSync(path);
}

const checks = [
  {
    id: "No FRED data path",
    pass:
      has("apps/worker/src/compliance/gates.ts", /gateF_fredHardBlock/) &&
      !has("apps/worker/src/ingest/types.ts", /FRED/)
  },
  {
    id: "GDELT citation visible",
    pass: has("apps/worker/src/services/store.ts", /Index data: GDELT/)
  },
  {
    id: "SEC 10 rps + declared UA",
    pass:
      has("apps/worker/src/services/rateLimiter.ts", /maxPerSecond/) &&
      has("apps/worker/src/services/sec.ts", /SEC_USER_AGENT/)
  },
  {
    id: "ECB raw vs derived separation",
    pass:
      has("apps/worker/src/services/store.ts", /raw_locked: true/) &&
      has("apps/worker/src/services/store.ts", /is_derived: true/)
  },
  {
    id: "Eurostat geo filter enforced",
    pass: has("apps/worker/src/compliance/gates.ts", /gateC_eurostatGeo/)
  },
  {
    id: "OECD/WB restricted gated",
    pass: has("apps/worker/src/compliance/gates.ts", /gateE_restrictedDataset/)
  },
  {
    id: "EU pre-consent ad block",
    pass:
      has("apps/web/src/components/AdSlot.tsx", /regionPolicy === "EU_UK_CH"/) &&
      has("apps/web/src/components/ConsentBanner.tsx", /Consent required/)
  },
  {
    id: "CMP signal bridge present (TCF/GPP/USP)",
    pass:
      has("apps/web/src/components/AdSlot.tsx", /__tcfapi/) &&
      has("apps/web/src/components/AdSlot.tsx", /__gpp/) &&
      has("apps/web/src/components/AdSlot.tsx", /__uspapi/)
  },
  {
    id: "US-state privacy geo policy",
    pass:
      has("apps/worker/src/routes/geo.ts", /US_STATE_PRIVACY/) &&
      has("apps/worker/src/routes/geo.ts", /us_state_privacy_required/)
  },
  {
    id: "Consent withdrawal removes loaded ad scripts",
    pass:
      has("apps/web/src/state/consent.tsx", /querySelectorAll\("script\[data-ofp-ad-script='1'\]"\)/) &&
      has("apps/web/src/state/consent.tsx", /\.remove\(\)/)
  },
  {
    id: "Ad metadata files staged for deployment",
    pass:
      exists("apps/web/public/ads.txt") &&
      has("apps/web/public/ads.txt", /publisher-id|DIRECT|RESELLER|Format/i) &&
      exists("apps/web/public/sellers.json") &&
      has("apps/web/public/sellers.json", /"sellers"\s*:/)
  }
];

let failed = 0;
for (const check of checks) {
  if (check.pass) {
    console.log(`[PASS] ${check.id}`);
  } else {
    failed += 1;
    console.error(`[FAIL] ${check.id}`);
  }
}

if (failed > 0) {
  process.exit(1);
}
