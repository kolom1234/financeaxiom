import { fetchSeriesFromDb } from "../services/postgres";
import { allowMemoryReadFallback } from "../services/fallbackPolicy";
import { MemoryStore } from "../services/store";
import { errorJson, okJson } from "./utils";
import type { Env } from "../types";

function isAllowedLicense(input: { license?: { commercial_status?: string } }): boolean {
  return input.license?.commercial_status === "allowed";
}

export async function handleSeries(request: Request, env: Env, seriesId: string): Promise<Response> {
  const url = new URL(request.url);
  const mode = (url.searchParams.get("mode") ?? "raw") as "raw" | "derived";
  if (mode !== "raw" && mode !== "derived") {
    return errorJson(request, env, 400, "mode must be raw or derived.");
  }

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const fromDb = await fetchSeriesFromDb(env, seriesId, mode, from, to);
  if (fromDb) {
    if (!isAllowedLicense(fromDb)) {
      return errorJson(request, env, 404, "Series not found.");
    }
    return okJson(request, env, fromDb);
  }
  if (!allowMemoryReadFallback(env)) {
    return errorJson(request, env, 503, "Persistent series store is unavailable.");
  }
  const series = MemoryStore.get().getSeries(seriesId, mode);
  if (!series) {
    return errorJson(request, env, 404, "Series not found.");
  }
  if (!isAllowedLicense(series)) {
    return errorJson(request, env, 404, "Series not found.");
  }

  const observations = series.observations.filter((obs) => {
    if (from && obs.obs_date < from) {
      return false;
    }
    if (to && obs.obs_date > to) {
      return false;
    }
    return true;
  });

  return okJson(request, env, {
    series_id: series.series_id,
    title: series.title,
    mode,
    units: series.units,
    raw_locked: series.raw_locked,
    source: series.source,
    license: series.license,
    observations
  });
}
