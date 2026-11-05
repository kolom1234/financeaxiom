import { z } from "zod";

/** Calendar date in ISO form (YYYY-MM-DD) that actually exists (rejects 2026-02-30). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date in YYYY-MM-DD format")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, "must be a valid calendar date");

export const entitySlug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "invalid entity slug").max(80);

/** Series UUID or public code such as US_CPI_YOY. */
export const seriesIdOrCode = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/, "invalid series id");

/** SEC accession number, e.g. 0001045810-26-000010. */
export const secAccession = z.string().regex(/^\d{10}-\d{2}-\d{6}$/, "invalid SEC accession number");

export const uuid = z.string().uuid();

export function parsePathParam<S extends z.ZodTypeAny>(schema: S, value: string): z.infer<S> | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}
