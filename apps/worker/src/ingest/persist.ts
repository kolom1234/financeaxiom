import { gateA_licenseSnapshot, gateF_fredHardBlock } from "../compliance/gates";
import type { PgClient } from "../services/db";
import { sha256Hex } from "../services/hash";
import {
  getExistingObservations,
  recordObservationRevisions,
  resolveLicenseContext,
  resolveSourceContext,
  upsertContentItem,
  upsertSeries,
  upsertSeriesObservations,
  type ObservationRevision,
  type SourceContext,
  type UpsertContentItemInput,
  type UpsertSeriesInput
} from "../services/ingestDb";
import type { NumPoint } from "./parse";

/** Registered source (seed.sql). A missing source is a deployment error, not a silent skip. */
export async function requireSource(client: PgClient, sourceName: string): Promise<SourceContext> {
  gateF_fredHardBlock(sourceName);
  const source = await resolveSourceContext(client, sourceName);
  if (!source) {
    throw new Error(`Source "${sourceName}" is not registered in the sources table.`);
  }
  return source;
}

/** License id for `code`, falling back to the source's default license. */
export async function licenseIdFor(client: PgClient, code: string, source: SourceContext): Promise<string> {
  const license = await resolveLicenseContext(client, code);
  return gateA_licenseSnapshot({ license_id: license?.licenseId ?? source.defaultLicenseId }).license_id as string;
}

/** Upserts a series and all its observations (one statement each). Returns the series id. */
export async function persistSeries(client: PgClient, definition: UpsertSeriesInput, points: NumPoint[]): Promise<string> {
  gateA_licenseSnapshot({ license_id: definition.licenseId });
  const seriesId = await upsertSeries(client, definition);
  await upsertSeriesObservations(
    client,
    seriesId,
    points.map((point) => ({ obsDate: point.obsDate, valueRaw: point.valueRaw, valueNum: point.valueNum }))
  );
  return seriesId;
}

/**
 * Persists a raw-locked series: values are stored exactly as published.
 * When the publisher revises a value, the new official value is applied and
 * the previous one is kept in series_observation_revisions (audit trail).
 */
export async function persistRawLockedSeries(
  client: PgClient,
  definition: UpsertSeriesInput,
  points: NumPoint[]
): Promise<{ seriesId: string; revisions: ObservationRevision[] }> {
  gateA_licenseSnapshot({ license_id: definition.licenseId });
  const seriesId = await upsertSeries(client, { ...definition, rawLocked: true });
  const existing = await getExistingObservations(
    client,
    seriesId,
    points.map((point) => point.obsDate)
  );

  const revisions: ObservationRevision[] = [];
  const rows = [];
  for (const point of points) {
    const hash = await sha256Hex(point.valueRaw);
    const previous = existing.get(point.obsDate);
    if (previous && previous.valueRaw !== point.valueRaw) {
      revisions.push({
        obsDate: point.obsDate,
        previousValueRaw: previous.valueRaw,
        newValueRaw: point.valueRaw,
        previousSourceHash: previous.sourceHash,
        newSourceHash: hash
      });
    }
    rows.push({ obsDate: point.obsDate, valueRaw: point.valueRaw, valueNum: point.valueNum, sourceHash: hash });
  }

  await recordObservationRevisions(client, seriesId, revisions);
  await upsertSeriesObservations(client, seriesId, rows);
  return { seriesId, revisions };
}

export async function persistContentItem(
  client: PgClient,
  input: UpsertContentItemInput
): Promise<{ itemId: string; inserted: boolean }> {
  gateA_licenseSnapshot({ license_id: input.licenseId });
  return upsertContentItem(client, input);
}
