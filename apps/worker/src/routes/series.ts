import { z } from "zod";
import { hasDatabase } from "../services/db";
import { allowMemoryReadFallback } from "../services/fallbackPolicy";
import { querySeries } from "../services/postgres";
import { MemoryStore } from "../services/store";
import { isoDate, parsePathParam, seriesIdOrCode } from "./schemas";
import { HttpError, okJson, parseQuery } from "./utils";
import type { Env } from "../types";

const SeriesQuerySchema = z
  .object({
    mode: z.enum(["raw", "derived"]).default("raw"),
    from: isoDate.optional(),
    to: isoDate.optional()
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "from must be on or before to",
    path: ["from"]
  });

export async function handleSeries(request: Request, env: Env, rawId: string): Promise<Response> {
  const seriesId = parsePathParam(seriesIdOrCode, rawId);
  if (!seriesId) {
    throw new HttpError(400, "Invalid series id.");
  }
  const { mode, from, to } = parseQuery(new URL(request.url), SeriesQuerySchema);

  if (hasDatabase(env)) {
    const series = await querySeries(env, seriesId, mode, from ?? null, to ?? null);
    if (!series) {
      throw new HttpError(404, "Series not found.");
    }
    return okJson(request, env, series);
  }

  if (!allowMemoryReadFallback(env)) {
    throw new HttpError(503, "Persistent series store is unavailable.");
  }
  const series = MemoryStore.get().getSeries(seriesId, mode);
  if (!series || series.license.commercial_status !== "allowed") {
    throw new HttpError(404, "Series not found.");
  }

  return okJson(request, env, {
    series_id: series.series_id,
    series_code: series.series_id,
    title: series.title,
    mode,
    units: series.units,
    raw_locked: series.raw_locked,
    source: series.source,
    license: series.license,
    observations: series.observations.filter((obs) => (!from || obs.obs_date >= from) && (!to || obs.obs_date <= to))
  });
}
