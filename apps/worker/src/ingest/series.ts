import { round, type NumPoint } from "./parse";

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`);
}

/** Same calendar day one year earlier (Feb 29 -> Feb 28). */
export function oneYearEarlier(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  const targetYear = year - 1;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);
  return `${targetYear}-${String(month).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

/**
 * The observation closest to exactly one year before `obsDate`, within
 * ±`toleranceDays` (ties resolve to the earlier date). Matching by date
 * rather than by array position keeps YoY correct when a period is missing
 * (e.g. BLS publishes "-" for October 2025 CPI) and works for weekly/daily data.
 */
export function findYearAgo(points: NumPoint[], obsDate: string, toleranceDays = 7): NumPoint | null {
  const targetMs = toUtcMs(oneYearEarlier(obsDate));
  let best: NumPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = Math.abs(toUtcMs(point.obsDate) - targetMs) / DAY_MS;
    if (distance > toleranceDays) {
      continue;
    }
    if (distance < bestDistance || (distance === bestDistance && best !== null && point.obsDate < best.obsDate)) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

/** Year-over-year % change for every point that has a matching point one year earlier. */
export function computeYearOverYear(points: NumPoint[], digits = 1): NumPoint[] {
  const sorted = [...points].sort((a, b) => a.obsDate.localeCompare(b.obsDate));
  const out: NumPoint[] = [];
  for (const point of sorted) {
    const prior = findYearAgo(sorted, point.obsDate);
    if (!prior || Math.abs(prior.valueNum) < 0.000001) {
      continue;
    }
    const value = round(((point.valueNum - prior.valueNum) / Math.abs(prior.valueNum)) * 100, digits);
    out.push({ obsDate: point.obsDate, valueNum: value, valueRaw: String(value) });
  }
  return out;
}
