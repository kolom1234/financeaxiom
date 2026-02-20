const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normalizeLicense(value) {
  if (typeof value !== "string") {
    return "UNKNOWN";
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "UNKNOWN";
}

function collectLockPackages(lockfile) {
  if (!lockfile || typeof lockfile !== "object" || !lockfile.packages || typeof lockfile.packages !== "object") {
    throw new Error("Invalid package-lock.json: expected top-level packages object.");
  }

  const rows = [];
  for (const [packagePath, rawMeta] of Object.entries(lockfile.packages)) {
    if (!packagePath.startsWith("node_modules/")) {
      continue;
    }

    const meta = rawMeta && typeof rawMeta === "object" ? rawMeta : {};
    const name = packagePath.replace(/^node_modules\//, "");
    const version = typeof meta.version === "string" ? meta.version : "UNKNOWN";
    const license = normalizeLicense(meta.license);
    const resolved = typeof meta.resolved === "string" ? meta.resolved : "";

    rows.push({ name, version, license, resolved });
  }

  rows.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return byName;
    }
    return left.version.localeCompare(right.version);
  });

  return rows;
}

function buildThirdPartyNotices(rows, lockfileHash, generatedAtIso) {
  const lines = [];
  lines.push("THIRD_PARTY_NOTICES");
  lines.push("");
  lines.push(`Generated at (UTC): ${generatedAtIso}`);
  lines.push("Source lockfile: package-lock.json");
  lines.push(`Lockfile SHA256: ${lockfileHash}`);
  lines.push("");
  lines.push("This file lists third-party npm packages and declared licenses from package-lock metadata.");
  lines.push("Validate notice/source-offer obligations against your actual distribution model.");
  lines.push("");

  for (const row of rows) {
    lines.push(`${row.name}@${row.version}`);
    lines.push(`  License: ${row.license}`);
    if (row.resolved) {
      lines.push(`  Resolved: ${row.resolved}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function generateThirdPartyNotices({ rootDir, outputPath }) {
  const lockfilePath = path.join(rootDir, "package-lock.json");
  const lockfileRaw = fs.readFileSync(lockfilePath, "utf8");
  const lockfile = JSON.parse(lockfileRaw);
  const lockfileHash = sha256(lockfileRaw);
  const rows = collectLockPackages(lockfile);
  const generatedAtIso = new Date().toISOString();
  const content = buildThirdPartyNotices(rows, lockfileHash, generatedAtIso);

  fs.writeFileSync(outputPath, content, "utf8");
  return { outputPath, packageCount: rows.length, lockfileHash };
}

if (require.main === module) {
  const rootDir = path.resolve(__dirname, "..", "..");
  const outputPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.join(rootDir, "THIRD_PARTY_NOTICES.txt");

  const result = generateThirdPartyNotices({ rootDir, outputPath });
  console.log(
    `[ok] wrote ${path.relative(rootDir, result.outputPath)} with ${result.packageCount} packages (lockfile sha: ${result.lockfileHash})`
  );
}

module.exports = {
  buildThirdPartyNotices,
  collectLockPackages,
  generateThirdPartyNotices,
  sha256
};
