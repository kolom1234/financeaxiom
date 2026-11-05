/** Small, dependency-free parsers shared by ingest sources. */

export type NumPoint = { obsDate: string; valueNum: number; valueRaw: string };

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Number from a JSON number or a numeric string ("1,234.5"); null for "-", "", "NA", etc. */
export function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.replace(/,/g, "").trim();
    if (!trimmed || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(trimmed)) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeCik(input: string): string {
  return input.replace(/\D/g, "").padStart(10, "0");
}

export function normalizeEntitySlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/** "2026-01" -> "2026-01-01". */
export function monthStartFromYearMonth(value: string): string | null {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    return null;
  }
  return `${match[1]}-${match[2]}-01`;
}

/** "2025Q4" -> "2025-10-01". */
export function parseQuarterStart(period: string): string | null {
  const match = period.match(/^(\d{4})Q([1-4])$/);
  if (!match) {
    return null;
  }
  const month = (Number(match[2]) - 1) * 3 + 1;
  return `${match[1]}-${pad2(month)}-01`;
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

export function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseCsvLine);
}

/** Parses a CSV with a header row into objects keyed by column name. */
export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const [header, ...rows] = parseCsv(text);
  if (!header) {
    return [];
  }
  return rows.map((columns) => Object.fromEntries(header.map((name, index) => [name.trim(), columns[index] ?? ""])));
}

export function sortByObsDate<T extends { obsDate: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.obsDate.localeCompare(b.obsDate));
}

export function latestPoint<T extends { obsDate: string }>(rows: T[]): T | null {
  const sorted = sortByObsDate(rows);
  return sorted[sorted.length - 1] ?? null;
}
