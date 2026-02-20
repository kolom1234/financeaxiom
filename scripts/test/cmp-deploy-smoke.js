async function fetchText(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "OFP-CMP-Smoke/1.0 (+contact@financeaxiom.com)"
    }
  });
  const text = await response.text();
  return { status: response.status, text, headers: response.headers };
}

function toAbsolute(baseUrl, maybeRelative) {
  return new URL(maybeRelative, baseUrl).toString();
}

function isLikelyHtml(response) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html")) {
    return true;
  }
  return /<!doctype html|<html/i.test(response.text);
}

function logCheck(id, pass, detail) {
  if (pass) {
    console.log(`[PASS] ${id} :: ${detail}`);
  } else {
    console.error(`[FAIL] ${id} :: ${detail}`);
  }
  return pass;
}

async function main() {
  const baseUrl = (process.env.CMP_SMOKE_URL || "https://financeaxiom.com").replace(/\/+$/, "");
  let failed = 0;

  const home = await fetchText(baseUrl);
  if (!logCheck("home reachable", home.status === 200, `status=${home.status} url=${baseUrl}`)) {
    process.exit(1);
  }

  const assetMatch = home.text.match(/<script[^>]+src="([^"]*index-[^"]+\.js)"/i);
  if (!assetMatch) {
    logCheck("bundle path extracted", false, "missing index-*.js entry in homepage HTML");
    process.exit(1);
  }
  const bundleUrl = toAbsolute(baseUrl, assetMatch[1]);
  logCheck("bundle path extracted", true, bundleUrl);

  const bundle = await fetchText(bundleUrl);
  if (!logCheck("bundle reachable", bundle.status === 200, `status=${bundle.status}`)) {
    process.exit(1);
  }

  const markers = [
    "__tcfapi",
    "__gpp",
    "__uspapi",
    "US_STATE_PRIVACY",
    "ofpCmpTcf",
    "ofpCmpGpp",
    "ofpCmpUsPrivacy"
  ];
  for (const marker of markers) {
    const pass = bundle.text.includes(marker);
    if (!logCheck(`bundle marker ${marker}`, pass, pass ? "present" : "missing")) {
      failed += 1;
    }
  }

  for (const adMetaPath of ["/ads.txt", "/sellers.json"]) {
    const url = `${baseUrl}${adMetaPath}`;
    const response = await fetchText(url);
    const htmlLike = isLikelyHtml(response);
    const pass = response.status === 200 && !htmlLike;
    if (
      !logCheck(
        `${adMetaPath} published`,
        pass,
        `status=${response.status} content-type=${response.headers.get("content-type") || "unknown"} html=${htmlLike}`
      )
    ) {
      failed += 1;
    }
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[FAIL] cmp deploy smoke execution error", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
