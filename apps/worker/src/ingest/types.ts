import type { IngestQueueMessage, MacroSource } from "../types";

export const ALLOWED_INGEST_JOBS: IngestQueueMessage["job"][] = [
  "INGEST_GDELT",
  "INGEST_SEC",
  "INGEST_MACRO",
  "MAINTENANCE_RETENTION",
  "RECOMPUTE_DERIVED"
];

export const MACRO_SOURCES: MacroSource[] = ["BLS", "EIA", "ECB", "FRB", "BEA", "EUROSTAT", "OECD", "WORLD_BANK"];
